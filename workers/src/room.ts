import { DurableObject } from "cloudflare:workers";

import { encodeEnvelope, decodeEnvelope } from "./protocol";
import { RoomHub, type Send } from "./roomLogic";
import { readScene, writeScene } from "./sceneStore";
import type { Env } from "./types";

interface SocketAttachment {
  socketId: string;
}

const corsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-Match",
  "Access-Control-Expose-Headers": "ETag",
  "Access-Control-Max-Age": "86400",
});

const newSocketId = (): string => {
  // Excalidraw Socket.io ids are short hex strings; emulate that.
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export class CollabRoom extends DurableObject<Env> {
  private hub = new RoomHub();
  // Map socketId -> WebSocket — needed because Hibernation API hands us back a
  // WebSocket on incoming events but our hub talks in socketIds.
  private sockets = new Map<string, WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // Re-attach hub state for any sockets that survived hibernation.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      this.sockets.set(att.socketId, ws);
      this.hub.addPeer(att.socketId, this.makeSend(att.socketId));
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request.headers.get("Origin")),
      });
    }

    // /scene — GET / PUT (replaces Firestore /scenes/{roomId})
    if (path.endsWith("/scene")) {
      return this.handleScene(request);
    }

    // /ws — WebSocket upgrade
    if (path.endsWith("/ws")) {
      return this.handleWebSocket(request);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleScene(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (request.method === "GET") {
      const scene = await readScene(this.ctx.storage);
      if (!scene) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders(origin),
        });
      }
      return new Response(JSON.stringify(scene), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ETag: `"${scene.sceneVersion}"`,
          ...corsHeaders(origin),
        },
      });
    }

    if (request.method === "PUT") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON", {
          status: 400,
          headers: corsHeaders(origin),
        });
      }
      const ifMatch = request.headers.get("If-Match");
      const result = await writeScene(this.ctx.storage, body, ifMatch);

      if (result.ok) {
        return new Response(JSON.stringify(result.scene), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: result.etag!,
            ...corsHeaders(origin),
          },
        });
      }
      if (result.status === 412 && result.scene) {
        return new Response(JSON.stringify(result.scene), {
          status: 412,
          headers: {
            "Content-Type": "application/json",
            ETag: result.etag!,
            ...corsHeaders(origin),
          },
        });
      }
      return new Response("Bad request", {
        status: result.status,
        headers: corsHeaders(origin),
      });
    }

    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const socketId = newSocketId();
    server.serializeAttachment({ socketId } satisfies SocketAttachment);

    // Hibernation API — DO can hibernate while sockets stay open.
    this.ctx.acceptWebSocket(server);
    this.sockets.set(socketId, server);
    this.hub.addPeer(socketId, this.makeSend(socketId));

    // Tell the client what its socketId is, so the wrapper can expose it as
    // socket.id (matches socket.io-client semantics).
    server.send(encodeEnvelope("__welcome", [socketId]));

    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Hibernation API handlers -----------------------------------------------

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      // We only speak JSON envelopes
      return;
    }

    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) {
      return;
    }
    let env;
    try {
      env = decodeEnvelope(message);
    } catch {
      return;
    }

    switch (env.t) {
      case "join-room": {
        const roomId = env.a[0];
        if (typeof roomId !== "string") return;
        this.hub.joinRoom(att.socketId, roomId);
        return;
      }
      case "server-broadcast":
      case "server-volatile-broadcast": {
        const [roomId, buf, iv] = env.a;
        if (
          typeof roomId !== "string" ||
          !(buf instanceof Uint8Array) ||
          !(iv instanceof Uint8Array)
        ) {
          return;
        }
        this.hub.relayBroadcast(att.socketId, roomId, buf, iv);
        return;
      }
      case "user-follow": {
        const payload = env.a[0];
        if (
          payload &&
          typeof payload === "object" &&
          "userToFollow" in payload &&
          "action" in payload
        ) {
          this.hub.userFollow(
            att.socketId,
            payload as Parameters<RoomHub["userFollow"]>[1],
          );
        }
        return;
      }
      default:
        // Unknown event — ignore, future-proof.
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.cleanupSocket(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.cleanupSocket(ws);
  }

  private cleanupSocket(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;
    this.hub.removePeer(att.socketId);
    this.sockets.delete(att.socketId);
  }

  private makeSend(socketId: string): Send {
    return ({ t, a }) => {
      const ws = this.sockets.get(socketId);
      if (!ws) return;
      try {
        ws.send(encodeEnvelope(t, a));
      } catch {
        this.hub.removePeer(socketId);
        this.sockets.delete(socketId);
      }
    };
  }
}
