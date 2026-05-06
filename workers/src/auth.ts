import { createRemoteJWKSet, jwtVerify } from "jose";
import { generateSessionToken } from "./crypto";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AuthContext,
  type Env,
  type Role,
  type SessionRecord,
  type ApiKeyRecord,
  type UserRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const parseCookie = (header: string | null, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v ?? null;
  }
  return null;
};

export const sessionCookieHeader = (
  token: string,
  maxAge = SESSION_TTL_SECONDS,
): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

export const clearCookieHeader = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ---------------------------------------------------------------------------
// Session management (local mode)
// ---------------------------------------------------------------------------

export const createSession = async (
  env: Env,
  username: string,
  role: Role,
): Promise<string> => {
  const token = generateSessionToken();
  const record: SessionRecord = { username, role, createdAt: Date.now() };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
};

export const deleteSession = async (env: Env, token: string): Promise<void> => {
  await env.SESSIONS.delete(`session:${token}`);
};

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

/**
 * Resolves caller identity. Strategy depends on env configuration:
 *
 *   CF_ACCESS_AUTH_DOMAIN set → Cloudflare Access mode
 *     Verifies the `CF-Access-Jwt-Assertion` JWT using the team's JWKS endpoint.
 *     Users are auto-provisioned in USERS KV with role "user" on first access;
 *     promote to admin via the admin API.
 *
 *   CF_ACCESS_AUTH_DOMAIN absent → Local auth mode
 *     Checks Bearer API key first, then __session cookie.
 */
export const resolveAuth = async (
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  if (env.CF_ACCESS_AUTH_DOMAIN) {
    return resolveCfAccessAuth(request, env);
  }
  return resolveLocalAuth(request, env);
};

// ---------------------------------------------------------------------------
// Cloudflare Access mode
// ---------------------------------------------------------------------------

/**
 * Verify the CF-Access-Jwt-Assertion JWT using the team's remote JWKS.
 * jose handles signature verification, expiry, and (optionally) audience check.
 */
const resolveCfAccessAuth = async (
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return null;

  const teamDomain = env.CF_ACCESS_AUTH_DOMAIN!;
  const JWKS = createRemoteJWKSet(
    new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
  );

  let email: string;
  try {
    const { payload } = await jwtVerify(assertion, JWKS, {
      issuer: `https://${teamDomain}`,
      ...(env.CF_ACCESS_AUD ? { audience: env.CF_ACCESS_AUD } : {}),
    });
    email = payload["email"] as string;
    if (!email) return null;
  } catch {
    return null;
  }

  // Look up or auto-provision the user's role in USERS KV.
  const existing = await env.USERS.get<UserRecord>(`user:${email}`, "json");
  if (existing) {
    return { username: email, role: existing.role };
  }

  // First access — provision with "user" role by default.
  const newRecord: UserRecord = { role: "user", createdAt: Date.now() };
  await env.USERS.put(`user:${email}`, JSON.stringify(newRecord));
  return { username: email, role: "user" };
};

// ---------------------------------------------------------------------------
// Local auth mode
// ---------------------------------------------------------------------------

const resolveLocalAuth = async (
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  // API key takes priority so scripts always work regardless of cookies.
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7).trim();
    const record = await env.APIKEYS.get<ApiKeyRecord>(`apikey:${key}`, "json");
    if (record) {
      const user = await env.USERS.get<UserRecord>(`user:${record.username}`, "json");
      if (user) return { username: record.username, role: user.role };
    }
    return null; // Invalid key — don't fall through to cookie.
  }

  const token = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;

  const session = await env.SESSIONS.get<SessionRecord>(`session:${token}`, "json");
  if (!session) return null;

  return { username: session.username, role: session.role };
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const isBrowserRequest = (request: Request): boolean =>
  (request.headers.get("Accept") ?? "").includes("text/html");

/**
 * Wraps a handler that requires an authenticated caller.
 * Browsers are redirected to /login; API callers receive 401 JSON.
 */
export const requireAuth = async (
  request: Request,
  env: Env,
  handler: (request: Request, env: Env, auth: AuthContext) => Promise<Response>,
): Promise<Response> => {
  const auth = await resolveAuth(request, env);
  if (!auth) {
    if (isBrowserRequest(request)) {
      const next = encodeURIComponent(new URL(request.url).pathname);
      return Response.redirect(
        new URL(`/login?next=${next}`, request.url).toString(),
        302,
      );
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handler(request, env, auth);
};

/** Like requireAuth but also asserts admin role (403 if not). */
export const requireAdmin = async (
  request: Request,
  env: Env,
  handler: (request: Request, env: Env, auth: AuthContext) => Promise<Response>,
): Promise<Response> =>
  requireAuth(request, env, async (req, e, auth) => {
    if (auth.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(req, e, auth);
  });
