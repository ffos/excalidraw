/**
 * Builds a full in-memory Env for tests, including the new auth KV namespaces.
 */
import type { Env } from "../src/types";
import { MemoryKV, MemoryR2 } from "./helpers";

export const makeFullEnv = (
  overrides: Partial<Env> = {},
): Env =>
  ({
    SCENES: new MemoryKV() as unknown as KVNamespace,
    FILES: new MemoryR2() as unknown as R2Bucket,
    ROOMS: undefined as unknown as DurableObjectNamespace,
    USERS: new MemoryKV() as unknown as KVNamespace,
    SESSIONS: new MemoryKV() as unknown as KVNamespace,
    APIKEYS: new MemoryKV() as unknown as KVNamespace,
    ASSETS: {
      fetch: async (req: RequestInfo) =>
        new Response(`asset:${typeof req === "string" ? req : (req as Request).url}`, { status: 200 }),
    } as unknown as Fetcher,
    ENVIRONMENT: "test",
    ...overrides,
  }) as Env;
