import { describe, it, expect, beforeEach } from "vitest";

import { route } from "../src/router";
import { createSession } from "../src/auth";
import { hashPassword } from "../src/crypto";
import { SESSION_COOKIE } from "../src/types";
import type { Env, UserRecord } from "../src/types";
import { makeFullEnv } from "./envFactory";

const fakeRoomsNamespace = () => {
  const calls: { idName: string; req: Request }[] = [];
  return {
    calls,
    ns: {
      idFromName: (name: string) => ({ __name: name }),
      get: (id: { __name: string }) => ({
        fetch: async (req: Request) => {
          calls.push({ idName: id.__name, req });
          return new Response("from-do", { status: 200 });
        },
      }),
    } as unknown as DurableObjectNamespace,
  };
};

let sessionCookie = "";

const makeEnv = () => {
  const rooms = fakeRoomsNamespace();
  const env = makeFullEnv({ ROOMS: rooms.ns });
  return { rooms, env };
};

const withAuth = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string>),
    Cookie: `${SESSION_COOKIE}=${sessionCookie}`,
  },
});

describe("router", () => {
  let env: Env;
  let rooms: ReturnType<typeof fakeRoomsNamespace>;

  beforeEach(async () => {
    ({ env, rooms } = makeEnv());
    // Seed a user and create a session for auth
    const passwordHash = await hashPassword("testpass");
    const record: UserRecord = { passwordHash, role: "user", createdAt: Date.now() };
    await env.USERS.put("user:testuser", JSON.stringify(record));
    sessionCookie = await createSession(env, "testuser", "user");
  });

  it("forwards /api/v2/post to the scene handler", async () => {
    const res = await route(
      new Request("https://w/api/v2/post/", withAuth({
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      })),
      env,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const json = (await res!.json()) as { id: string };
    expect(json.id).toMatch(/^[a-f0-9]+$/);
  });

  it("forwards /api/v2/{id} to the scene GET handler", async () => {
    const post = await route(
      new Request("https://w/api/v2/post/", withAuth({
        method: "POST",
        body: new Uint8Array([1]),
      })),
      env,
    );
    const { id } = (await post!.json()) as { id: string };
    const get = await route(new Request(`https://w/api/v2/${id}`, withAuth()), env);
    expect(get!.status).toBe(200);
  });

  it("forwards /api/files/* to file handlers", async () => {
    const path = "files/shareLinks/abc/file1";
    const put = await route(
      new Request(`https://w/api/${path}`, withAuth({
        method: "PUT",
        body: new Uint8Array([7]),
      })),
      env,
    );
    expect(put!.status).toBe(200);
    const get = await route(new Request(`https://w/api/${path}`, withAuth()), env);
    expect(get!.status).toBe(200);
  });

  it("forwards /api/room/{id}/ws to the durable object", async () => {
    const res = await route(
      new Request("https://w/api/room/room42/ws", withAuth({
        headers: { Upgrade: "websocket", Cookie: `${SESSION_COOKIE}=${sessionCookie}` },
      })),
      env,
    );
    expect(res!.status).toBe(200);
    expect(rooms.calls).toHaveLength(1);
    expect(rooms.calls[0].idName).toBe("room42");
  });

  it("forwards /api/room/{id}/scene to the durable object", async () => {
    const res = await route(new Request("https://w/api/room/room42/scene", withAuth()), env);
    expect(res!.status).toBe(200);
    expect(rooms.calls).toHaveLength(1);
  });

  it("rejects malformed room ids", async () => {
    const res = await route(
      new Request("https://w/api/room/has spaces/ws", withAuth()),
      env,
    );
    expect(res!.status).toBe(400);
  });

  it("returns 401 for non-API paths when unauthenticated", async () => {
    const res = await route(new Request("https://w/index.html"), env);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("returns 404 for unknown /api paths", async () => {
    const res = await route(new Request("https://w/api/unknown", withAuth()), env);
    expect(res!.status).toBe(404);
  });

  it("returns 405 on wrong method for scene endpoints", async () => {
    const res = await route(
      new Request("https://w/api/v2/post/", withAuth({ method: "GET" })),
      env,
    );
    expect(res!.status).toBe(405);
  });
});
