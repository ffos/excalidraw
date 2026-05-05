import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AuthContext,
  type Env,
  type SessionRecord,
  type ApiKeyRecord,
} from "./types";

const parseCookie = (header: string | null, name: string): string | null => {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return v ?? null;
  }
  return null;
};

/**
 * Resolves the caller's identity from either:
 *  1. __session cookie  (browser sessions)
 *  2. Authorization: Bearer <api-key>  (programmatic access)
 *
 * Returns AuthContext on success, null if unauthenticated.
 */
export const resolveAuth = async (
  request: Request,
  env: Env,
): Promise<AuthContext | null> => {
  // --- API key (header takes priority so scripts always work) ---
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7).trim();
    const record = await env.APIKEYS.get<ApiKeyRecord>(
      `apikey:${key}`,
      "json",
    );
    if (record) {
      const user = await env.USERS.get<{
        role: "admin" | "user";
      }>(`user:${record.username}`, "json");
      if (user) {
        return { username: record.username, role: user.role };
      }
    }
    return null; // Invalid key — hard 401 (don't fall through to cookie)
  }

  // --- Session cookie ---
  const token = parseCookie(
    request.headers.get("Cookie"),
    SESSION_COOKIE,
  );
  if (!token) return null;

  const session = await env.SESSIONS.get<SessionRecord>(
    `session:${token}`,
    "json",
  );
  if (!session) return null;

  return { username: session.username, role: session.role };
};

/** Create a session, return the token. */
export const createSession = async (
  env: Env,
  username: string,
  role: "admin" | "user",
): Promise<string> => {
  const { generateSessionToken } = await import("./crypto");
  const token = generateSessionToken();
  const record: SessionRecord = {
    username,
    role,
    createdAt: Date.now(),
  };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
};

/** Delete a session (logout). */
export const deleteSession = async (
  env: Env,
  token: string,
): Promise<void> => {
  await env.SESSIONS.delete(`session:${token}`);
};

/** Build a Set-Cookie header that plants the session token. */
export const sessionCookieHeader = (
  token: string,
  maxAge = SESSION_TTL_SECONDS,
): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

/** Build a Set-Cookie header that clears the session cookie. */
export const clearCookieHeader = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** True if the request looks like a browser (accepts HTML). */
const isBrowserRequest = (request: Request): boolean =>
  (request.headers.get("Accept") ?? "").includes("text/html");

/**
 * Middleware: wraps a handler that needs an authenticated caller.
 * - Redirects browsers to /login
 * - Returns 401 JSON for API/programmatic requests
 * - Calls `handler(request, env, auth)` when authenticated
 */
export const requireAuth = async (
  request: Request,
  env: Env,
  handler: (
    request: Request,
    env: Env,
    auth: AuthContext,
  ) => Promise<Response>,
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

/**
 * Middleware: like requireAuth but also asserts admin role.
 */
export const requireAdmin = async (
  request: Request,
  env: Env,
  handler: (
    request: Request,
    env: Env,
    auth: AuthContext,
  ) => Promise<Response>,
): Promise<Response> => {
  return requireAuth(request, env, async (req, e, auth) => {
    if (auth.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(req, e, auth);
  });
};
