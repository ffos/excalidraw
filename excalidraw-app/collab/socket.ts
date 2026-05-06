/**
 * Tiny WebSocket wrapper that exposes a socket.io-client-style API to the
 * rest of the app.  We use this so the substantial Collab.tsx / Portal.tsx
 * call sites can stay (mostly) unchanged when we move from the Socket.io
 * server (`oss-collab.excalidraw.com`) to the CollabRoom Durable Object.
 *
 * Wire format is the JSON envelope defined in `workers/src/protocol.ts`:
 *   { t: "event", a: [arg1, arg2, ...] }
 * Binary args (ArrayBuffer / Uint8Array) are wrapped as { __b: "<base64>" }.
 */

// Listener arg shapes are dictated by the server-side protocol per event;
// callers pass typed callbacks. Match socket.io-client's loose typing so we
// don't have to thread generics through the Collab/Portal call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;

const toBase64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const isBinaryMarker = (
  v: unknown,
): v is { __b: string } =>
  typeof v === "object" &&
  v !== null &&
  "__b" in v &&
  typeof (v as { __b: unknown }).__b === "string";

const encodeArg = (v: unknown): unknown =>
  v instanceof ArrayBuffer || v instanceof Uint8Array
    ? { __b: toBase64(v) }
    : v;

const decodeArg = (v: unknown): unknown =>
  isBinaryMarker(v) ? fromBase64(v.__b) : v;

export const encodeFrame = (event: string, args: unknown[]): string =>
  JSON.stringify({ t: event, a: args.map(encodeArg) });

export const decodeFrame = (
  frame: string,
): { t: string; a: unknown[] } | null => {
  try {
    const parsed = JSON.parse(frame) as { t: unknown; a: unknown };
    if (typeof parsed.t !== "string" || !Array.isArray(parsed.a)) {
      return null;
    }
    return { t: parsed.t, a: parsed.a.map(decodeArg) };
  } catch {
    return null;
  }
};

interface SocketOptions {
  /** Optional WebSocket factory, used in tests. */
  webSocketFactory?: (url: string) => WebSocket;
}

export class Socket {
  /** Server-assigned socket id (matches socket.io's `socket.id`). */
  public id: string | undefined;

  private ws: WebSocket;
  private listeners = new Map<string, Set<Listener>>();
  private onceListeners = new Map<string, Set<Listener>>();
  private outboundQueue: string[] = [];
  private isOpen = false;
  private isClosed = false;

  constructor(url: string, opts: SocketOptions = {}) {
    const factory = opts.webSocketFactory ?? ((u) => new WebSocket(u));
    this.ws = factory(url);

    this.ws.addEventListener("open", () => {
      this.isOpen = true;
      for (const frame of this.outboundQueue) {
        this.ws.send(frame);
      }
      this.outboundQueue = [];
    });
    this.ws.addEventListener("message", (ev) => this.onFrame(ev.data));
    this.ws.addEventListener("error", () => this.dispatch("connect_error", []));
    this.ws.addEventListener("close", () => {
      this.isClosed = true;
      this.dispatch("disconnect", []);
    });
  }

  emit(event: string, ...args: unknown[]): void {
    const frame = encodeFrame(event, args);
    if (this.isOpen && !this.isClosed) {
      this.ws.send(frame);
    } else if (!this.isClosed) {
      this.outboundQueue.push(frame);
    }
  }

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return this;
  }

  once(event: string, fn: Listener): this {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn?: Listener): this {
    if (!fn) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
      return this;
    }
    this.listeners.get(event)?.delete(fn);
    this.onceListeners.get(event)?.delete(fn);
    return this;
  }

  close(): void {
    this.isClosed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  private onFrame(data: unknown): void {
    if (typeof data !== "string") return;
    const env = decodeFrame(data);
    if (!env) return;

    if (env.t === "__welcome") {
      const id = env.a[0];
      if (typeof id === "string") {
        this.id = id;
      }
      return;
    }

    this.dispatch(env.t, env.a);
  }

  private dispatch(event: string, args: unknown[]): void {
    const subs = this.listeners.get(event);
    if (subs) {
      for (const fn of [...subs]) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    }
    const onceSubs = this.onceListeners.get(event);
    if (onceSubs) {
      this.onceListeners.delete(event);
      for (const fn of onceSubs) {
        try {
          fn(...args);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }
}

/**
 * Connects to the CollabRoom Durable Object. The HTTP base URL gets rewritten
 * to a ws/wss URL automatically. Call sites pass the same env var the old
 * Socket.io path used (`VITE_APP_WS_SERVER_URL`).
 */
export const connect = (
  baseUrl: string,
  roomId: string,
  opts: SocketOptions = {},
): Socket => {
  const url = new URL(`/api/room/${roomId}/ws`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new Socket(url.toString(), opts);
};
