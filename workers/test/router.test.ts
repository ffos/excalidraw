import { describe, it, expect } from "vitest";

import { route } from "../src/router";
import type { Env } from "../src/types";
import { MemoryKV, MemoryR2 } from "./helpers";

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

const makeEnv = () => {
  const rooms = fakeRoomsNamespace();
  return {
    rooms,
    env: {
      SCENES: new MemoryKV() as unknown as KVNamespace,
      FILES: new MemoryR2() as unknown as R2Bucket,
      ROOMS: rooms.ns,
    } satisfies Env,
  };
};

describe("router", () => {
  it("forwards /api/v2/post to the scene handler", async () => {
    const { env } = makeEnv();
    const res = await route(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: new Uint8Array([1, 2, 3]),
      }),
      env,
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const json = (await res!.json()) as { id: string };
    expect(json.id).toMatch(/^[a-f0-9]+$/);
  });

  it("forwards /api/v2/{id} to the scene GET handler", async () => {
    const { env } = makeEnv();
    const post = await route(
      new Request("https://w/api/v2/post/", {
        method: "POST",
        body: new Uint8Array([1]),
      }),
      env,
    );
    const { id } = (await post!.json()) as { id: string };
    const get = await route(new Request(`https://w/api/v2/${id}`), env);
    expect(get!.status).toBe(200);
  });

  it("forwards /api/files/* to file handlers", async () => {
    const { env } = makeEnv();
    const path = "files/shareLinks/abc/file1";
    const put = await route(
      new Request(`https://w/api/${path}`, {
        method: "PUT",
        body: new Uint8Array([7]),
      }),
      env,
    );
    expect(put!.status).toBe(200);
    const get = await route(new Request(`https://w/api/${path}`), env);
    expect(get!.status).toBe(200);
  });

  it("forwards /api/room/{id}/ws to the durable object", async () => {
    const { env, rooms } = makeEnv();
    const res = await route(
      new Request("https://w/api/room/room42/ws", {
        headers: { Upgrade: "websocket" },
      }),
      env,
    );
    expect(res!.status).toBe(200);
    expect(rooms.calls).toHaveLength(1);
    expect(rooms.calls[0].idName).toBe("room42");
  });

  it("forwards /api/room/{id}/scene to the durable object", async () => {
    const { env, rooms } = makeEnv();
    const res = await route(new Request("https://w/api/room/room42/scene"), env);
    expect(res!.status).toBe(200);
    expect(rooms.calls).toHaveLength(1);
  });

  it("rejects malformed room ids", async () => {
    const { env } = makeEnv();
    const res = await route(
      new Request("https://w/api/room/has spaces/ws"),
      env,
    );
    expect(res!.status).toBe(400);
  });

  it("returns null for non-API paths so the host can serve assets", async () => {
    const { env } = makeEnv();
    const res = await route(new Request("https://w/index.html"), env);
    expect(res).toBeNull();
  });

  it("returns 404 for unknown /api paths", async () => {
    const { env } = makeEnv();
    const res = await route(new Request("https://w/api/unknown"), env);
    expect(res!.status).toBe(404);
  });

  it("returns 405 on wrong method for scene endpoints", async () => {
    const { env } = makeEnv();
    const res = await route(
      new Request("https://w/api/v2/post/", { method: "GET" }),
      env,
    );
    expect(res!.status).toBe(405);
  });
});
