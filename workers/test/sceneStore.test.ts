import { describe, it, expect, beforeEach } from "vitest";

import { readScene, writeScene, type SceneStorage } from "../src/sceneStore";

const makeStorage = (): SceneStorage => {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      map.set(key, value);
    },
  };
};

const sample = (sceneVersion: number) => ({
  sceneVersion,
  iv: "aXY=", // "iv" base64
  ciphertext: "Y2lwaGVy", // "cipher" base64
});

describe("sceneStore", () => {
  let storage: SceneStorage;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("readScene returns null when empty", async () => {
    expect(await readScene(storage)).toBeNull();
  });

  it("first write succeeds with no precondition", async () => {
    const res = await writeScene(storage, sample(1), null);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.etag).toBe('"1"');
    expect(await readScene(storage)).toEqual(sample(1));
  });

  it("blind overwrite (no If-Match) is rejected", async () => {
    await writeScene(storage, sample(1), null);
    const res = await writeScene(storage, sample(2), null);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(412);
    expect(res.scene?.sceneVersion).toBe(1);
  });

  it("matching If-Match overwrites", async () => {
    await writeScene(storage, sample(1), null);
    const res = await writeScene(storage, sample(2), '"1"');
    expect(res.ok).toBe(true);
    expect(res.etag).toBe('"2"');
  });

  it("stale If-Match returns 412 with current document", async () => {
    await writeScene(storage, sample(2), null);
    const res = await writeScene(storage, sample(3), '"1"');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(412);
    expect(res.scene?.sceneVersion).toBe(2);
    expect(res.etag).toBe('"2"');
  });

  it("If-Match supplied but document missing returns 412", async () => {
    const res = await writeScene(storage, sample(1), '"0"');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(412);
  });

  it("malformed body returns 400", async () => {
    const res = await writeScene(storage, { foo: "bar" }, null);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});
