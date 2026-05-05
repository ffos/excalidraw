import { describe, it, expect, vi } from "vitest";

import {
  Socket,
  encodeFrame,
  decodeFrame,
  connect,
} from "../collab/socket";

class FakeWebSocket {
  public sent: string[] = [];
  public readyState = 0;
  private listeners = new Map<string, Set<(ev: any) => void>>();
  constructor(public url: string) {}

  addEventListener(type: string, fn: (ev: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.dispatch("close", {});
  }

  // --- test helpers ----------------------------------------------------
  open() {
    this.readyState = 1;
    this.dispatch("open", {});
  }

  receive(frame: string) {
    this.dispatch("message", { data: frame });
  }

  error() {
    this.dispatch("error", {});
  }

  private dispatch(type: string, ev: any) {
    const subs = this.listeners.get(type);
    if (!subs) return;
    for (const fn of subs) fn(ev);
  }
}

const newSocket = () => {
  const fakes: FakeWebSocket[] = [];
  const sock = new Socket("ws://x/api/room/r/ws", {
    webSocketFactory: (url) => {
      const fake = new FakeWebSocket(url);
      fakes.push(fake);
      return fake as unknown as WebSocket;
    },
  });
  return { sock, fake: fakes[0] };
};

describe("Socket wrapper", () => {
  it("queues emit() until the socket opens", () => {
    const { sock, fake } = newSocket();
    sock.emit("join-room", "abc");
    expect(fake.sent).toEqual([]);
    fake.open();
    expect(fake.sent).toHaveLength(1);
    const env = decodeFrame(fake.sent[0]);
    expect(env?.t).toBe("join-room");
    expect(env?.a).toEqual(["abc"]);
  });

  it("flushes multiple queued frames in order on open", () => {
    const { sock, fake } = newSocket();
    sock.emit("a", 1);
    sock.emit("b", 2);
    fake.open();
    expect(fake.sent.map((f) => decodeFrame(f)!.t)).toEqual(["a", "b"]);
  });

  it("delivers events to on() listeners", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const cb = vi.fn();
    sock.on("init-room", cb);
    fake.receive(encodeFrame("init-room", []));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("once() fires only the first time", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const cb = vi.fn();
    sock.once("first-in-room", cb);
    fake.receive(encodeFrame("first-in-room", []));
    fake.receive(encodeFrame("first-in-room", []));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("off() removes a single listener", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const cb = vi.fn();
    sock.on("x", cb);
    sock.off("x", cb);
    fake.receive(encodeFrame("x", []));
    expect(cb).not.toHaveBeenCalled();
  });

  it("off(event) without fn removes all listeners", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const a = vi.fn();
    const b = vi.fn();
    sock.on("x", a);
    sock.on("x", b);
    sock.off("x");
    fake.receive(encodeFrame("x", []));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it("captures socket id from the __welcome frame", () => {
    const { sock, fake } = newSocket();
    fake.open();
    fake.receive(encodeFrame("__welcome", ["sid-123"]));
    expect(sock.id).toBe("sid-123");
  });

  it("decodes binary args back into Uint8Array", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const cb = vi.fn();
    sock.on("client-broadcast", cb);
    const buf = new Uint8Array([1, 2, 3, 250]);
    const iv = new Uint8Array([9, 8, 7]);
    fake.receive(encodeFrame("client-broadcast", [buf, iv]));
    expect(cb).toHaveBeenCalledTimes(1);
    const [argBuf, argIv] = cb.mock.calls[0];
    expect(argBuf).toBeInstanceOf(Uint8Array);
    expect([...argBuf]).toEqual([1, 2, 3, 250]);
    expect([...argIv]).toEqual([9, 8, 7]);
  });

  it("encodes binary args when emitting", () => {
    const { sock, fake } = newSocket();
    fake.open();
    sock.emit("server-broadcast", "room-x", new Uint8Array([1, 2]).buffer);
    expect(fake.sent).toHaveLength(1);
    const env = decodeFrame(fake.sent[0])!;
    expect(env.t).toBe("server-broadcast");
    expect(env.a[0]).toBe("room-x");
    expect(env.a[1]).toBeInstanceOf(Uint8Array);
  });

  it("emits connect_error on websocket error", () => {
    const { sock, fake } = newSocket();
    const cb = vi.fn();
    sock.on("connect_error", cb);
    fake.error();
    expect(cb).toHaveBeenCalled();
  });

  it("close() shuts down the underlying socket", () => {
    const { sock, fake } = newSocket();
    fake.open();
    const closeSpy = vi.spyOn(fake, "close");
    sock.close();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe("connect()", () => {
  it("rewrites https://host -> wss://host/api/room/{id}/ws", () => {
    const fakes: FakeWebSocket[] = [];
    connect("https://example.com", "myroom", {
      webSocketFactory: (url) => {
        const f = new FakeWebSocket(url);
        fakes.push(f);
        return f as unknown as WebSocket;
      },
    });
    expect(fakes[0].url).toBe("wss://example.com/api/room/myroom/ws");
  });

  it("rewrites http:// to ws:// for local dev", () => {
    const fakes: FakeWebSocket[] = [];
    connect("http://localhost:8787", "r", {
      webSocketFactory: (url) => {
        const f = new FakeWebSocket(url);
        fakes.push(f);
        return f as unknown as WebSocket;
      },
    });
    expect(fakes[0].url).toBe("ws://localhost:8787/api/room/r/ws");
  });
});
