export interface Env {
  SCENES: KVNamespace;
  FILES: R2Bucket;
  ROOMS: DurableObjectNamespace;
  /** Workers Static Assets binding — serves the pre-built SPA. */
  ASSETS: Fetcher;
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  APIKEYS: KVNamespace;

  /**
   * LOCAL AUTH MODE (default, useful for laptop/self-hosted deployments)
   *
   * If set and no admin user exists yet, an "admin" account is auto-created
   * on the first request then the secret is ignored.
   * Set via: wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
   */
  BOOTSTRAP_ADMIN_PASSWORD?: string;

  /**
   * CLOUDFLARE ACCESS MODE
   *
   * Set CF_ACCESS_AUTH_DOMAIN to your Zero Trust team domain
   * (e.g. "yourteam.cloudflareaccess.com") to delegate all authentication to
   * Cloudflare Access. The Worker verifies the signed CF-Access-Jwt-Assertion
   * header on every request using the team's public JWKS endpoint.
   *
   * When set, local username/password login is disabled — users authenticate
   * through the Cloudflare Access identity provider of your choice.
   */
  CF_ACCESS_AUTH_DOMAIN?: string;
  /** Cloudflare Access application Audience (AUD) tag — found in the Access
   *  application settings. When set, the JWT audience claim is validated. */
  CF_ACCESS_AUD?: string;

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
  /**
   * bcrypt hash string (includes embedded salt).
   * Absent for CF Access users (CF handles authentication; we only store role).
   */
  passwordHash?: string;
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
