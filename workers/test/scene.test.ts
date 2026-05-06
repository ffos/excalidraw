import { describe, it, expect } from "vitest";

import {
  handleScenePost,
  handleSceneGet,
  handleSceneOptions,
} from "../src/scene";
import { SCENE_MAX_BYTES, type Env } from "../src/types";
import { MemoryKV } from "./helpers";

const makeEnv = (): Env =>
  ({
    SCENES: new MemoryKV() as unknown as KVNamespace,
    FILES: undefined as unknown as R2Bucket,
    ROOMS: undefined as unknown as DurableObjectNamespace,
  }) as Env;

describe("scene API", () => {
  it("POST stores body and returns hex id", async () => {
    const env = makeEnv();
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const req = new Request("https://w/api/v2/post/", {
      method: "POST",
      body: payload,
    });

    const res = await handleScenePost(req, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string };
    expect(json.id).toMatch(/^[a-f0-9]{20}$/);
  });

  it("GET returns the bytes that were POSTed", async () => {
    const env = makeEnv();
    const payload = new Uint8Array([9, 8, 7, 6]);
    const post = await handleScenePost(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: payload,
      }),
      env,
    );
    const { id } = (await post.json()) as { id: string };

    const get = await handleSceneGet(
      new Request(`https://w/api/v2/${id}`),
      env,
      id,
    );
    expect(get.status).toBe(200);
    const buf = new Uint8Array(await get.arrayBuffer());
    expect([...buf]).toEqual([...payload]);
  });

  it("GET returns 404 for unknown id", async () => {
    const env = makeEnv();
    const id = "00000000000000000000";
    const res = await handleSceneGet(
      new Request(`https://w/api/v2/${id}`),
      env,
      id,
    );
    expect(res.status).toBe(404);
  });

  it("GET rejects malformed id", async () => {
    const env = makeEnv();
    const res = await handleSceneGet(
      new Request("https://w/api/v2/not-hex"),
      env,
      "not-hex",
    );
    expect(res.status).toBe(400);
  });

  it("POST rejects empty body", async () => {
    const env = makeEnv();
    const res = await handleScenePost(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: new Uint8Array(),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("POST rejects oversized payloads via Content-Length", async () => {
    const env = makeEnv();
    const res = await handleScenePost(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: new Uint8Array(8),
        headers: { "Content-Length": String(SCENE_MAX_BYTES + 1) },
      }),
      env,
    );
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error_class: string };
    expect(json.error_class).toBe("RequestTooLargeError");
  });

  it("OPTIONS returns CORS preflight", async () => {
    const res = handleSceneOptions(
      new Request("https://w/api/v2/post/", {
        method: "OPTIONS",
        headers: { Origin: "https://app.example" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("returns CORS header on POST/GET responses", async () => {
    const env = makeEnv();
    const post = await handleScenePost(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: new Uint8Array([1]),
        headers: { Origin: "https://app.example" },
      }),
      env,
    );
    expect(post.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
  });
});
