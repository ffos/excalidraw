export interface Env {
  SCENES: KVNamespace;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace;
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  APIKEYS: KVNamespace;
  /** Optional: set via `wrangler secret put BOOTSTRAP_ADMIN_PASSWORD`
   *  If set and no admin user exists yet, an "admin" account is auto-created
   *  on the first request and this secret is ignored thereafter. */
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  ENVIRONMENT?: string;
}

export const SCENE_ID_BYTES = 10;
export const SCENE_MAX_BYTES = 4 * 1024 * 1024;
export const FILE_MAX_BYTES = 3 * 1024 * 1024;
export const FILE_CACHE_MAX_AGE_SEC = 31536000;

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
export const SESSION_COOKIE = "__session";
export const API_KEY_PREFIX = "eak_"; // excalidraw api key

export type Role = "admin" | "user";

export interface UserRecord {
  passwordHash: string;
  salt: string;
  role: Role;
  createdAt: number;
}

export interface SessionRecord {
  username: string;
  role: Role;
  createdAt: number;
}

export interface ApiKeyRecord {
  username: string;
  label: string;
  createdAt: number;
}

export interface AuthContext {
  username: string;
  role: Role;
}
