import { describe, it, expect } from "vitest";

import {
  encodeEnvelope,
  decodeEnvelope,
  encodeArg,
  decodeArg,
} from "../src/protocol";

describe("protocol envelope", () => {
  it("round-trips simple events", () => {
    const wire = encodeEnvelope("join-room", ["room-id"]);
    const env = decodeEnvelope(wire);
    expect(env.t).toBe("join-room");
    expect(env.a).toEqual(["room-id"]);
  });

  it("round-trips ArrayBuffer args as binary", () => {
    const buf = new Uint8Array([1, 2, 3, 254, 255]).buffer;
    const wire = encodeEnvelope("server-broadcast", ["room-id", buf]);
    const env = decodeEnvelope(wire);
    expect(env.t).toBe("server-broadcast");
    expect(env.a[0]).toBe("room-id");
    const out = env.a[1];
    expect(out).toBeInstanceOf(Uint8Array);
    expect([...(out as Uint8Array)]).toEqual([1, 2, 3, 254, 255]);
  });

  it("round-trips Uint8Array args", () => {
    const u = new Uint8Array([10, 20, 30]);
    const wire = encodeEnvelope("e", [u]);
    const env = decodeEnvelope(wire);
    expect([...(env.a[0] as Uint8Array)]).toEqual([10, 20, 30]);
  });

  it("encodeArg leaves non-binary values alone", () => {
    expect(encodeArg("hello")).toBe("hello");
    expect(encodeArg(42)).toBe(42);
    expect(encodeArg({ a: 1 })).toEqual({ a: 1 });
  });

  it("decodeArg leaves non-binary values alone", () => {
    expect(decodeArg("hello")).toBe("hello");
    expect(decodeArg({ x: 1 })).toEqual({ x: 1 });
  });

  it("decodeEnvelope rejects malformed input", () => {
    expect(() => decodeEnvelope("not json")).toThrow();
    expect(() => decodeEnvelope(JSON.stringify({ t: 5, a: [] }))).toThrow();
    expect(() => decodeEnvelope(JSON.stringify({ t: "x" }))).toThrow();
  });
});
