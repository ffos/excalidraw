import { describe, it, expect } from "vitest";

import {
  handleFilePut,
  handleFileGet,
  handleFileOptions,
} from "../src/files";
import { FILE_MAX_BYTES, type Env } from "../src/types";
import { MemoryR2 } from "./helpers";

const makeEnv = (): Env =>
  ({
    SCENES: undefined as unknown as KVNamespace,
    FILES: new MemoryR2() as unknown as R2Bucket,
    ROOMS: undefined as unknown as DurableObjectNamespace,
  }) as Env;

const validShare = "files/shareLinks/abc123/file42";
const validRoom = "files/rooms/room-xyz/file42";

describe("files API", () => {
  it("PUT then GET round-trips bytes for a shareLink path", async () => {
    const env = makeEnv();
    const data = new Uint8Array([10, 20, 30, 40]);

    const put = await handleFilePut(
      new Request(`https://w/api/${validShare}`, {
        method: "PUT",
        body: data,
        headers: { "Content-Type": "image/png" },
      }),
      env,
      validShare,
    );
    expect(put.status).toBe(200);

    const get = await handleFileGet(
      new Request(`https://w/api/${validShare}`),
      env,
      validShare,
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    const out = new Uint8Array(await get.arrayBuffer());
    expect([...out]).toEqual([...data]);
  });

  it("PUT works for a rooms/* path", async () => {
    const env = makeEnv();
    const put = await handleFilePut(
      new Request(`https://w/api/${validRoom}`, {
        method: "PUT",
        body: new Uint8Array([1]),
      }),
      env,
      validRoom,
    );
    expect(put.status).toBe(200);
  });

  it("rejects paths outside the allowed prefixes", async () => {
    const env = makeEnv();
    const bad = "files/other/abc/file";
    const res = await handleFilePut(
      new Request(`https://w/api/${bad}`, {
        method: "PUT",
        body: new Uint8Array([1]),
      }),
      env,
      bad,
    );
    expect(res.status).toBe(400);
  });

  it("rejects path traversal characters", async () => {
    const env = makeEnv();
    const bad = "files/shareLinks/../etc/passwd";
    const res = await handleFileGet(
      new Request(`https://w/api/${bad}`),
      env,
      bad,
    );
    expect(res.status).toBe(400);
  });

  it("GET 404 for unknown file", async () => {
    const env = makeEnv();
    const res = await handleFileGet(
      new Request(`https://w/api/${validShare}`),
      env,
      validShare,
    );
    expect(res.status).toBe(404);
  });

  it("rejects empty PUT body", async () => {
    const env = makeEnv();
    const res = await handleFilePut(
      new Request(`https://w/api/${validShare}`, {
        method: "PUT",
        body: new Uint8Array(),
      }),
      env,
      validShare,
    );
    expect(res.status).toBe(400);
  });

  it("rejects oversized PUT via Content-Length", async () => {
    const env = makeEnv();
    const res = await handleFilePut(
      new Request(`https://w/api/${validShare}`, {
        method: "PUT",
        body: new Uint8Array([1]),
        headers: { "Content-Length": String(FILE_MAX_BYTES + 1) },
      }),
      env,
      validShare,
    );
    expect(res.status).toBe(413);
  });

  it("OPTIONS returns CORS preflight", async () => {
    const res = handleFileOptions(
      new Request(`https://w/api/${validShare}`, {
        method: "OPTIONS",
        headers: { Origin: "https://app.example" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });
});
