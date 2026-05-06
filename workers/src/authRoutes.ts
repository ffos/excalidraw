import {
  SESSION_COOKIE,
  API_KEY_PREFIX,
  type Env,
  type UserRecord,
  type ApiKeyRecord,
  type AuthContext,
} from "./types";
import {
  createSession,
  deleteSession,
  sessionCookieHeader,
  clearCookieHeader,
  requireAdmin,
  requireAuth,
} from "./auth";
import { hashPassword, verifyPassword, generateApiKey } from "./crypto";
import { loginPage } from "./loginPage";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------------------
// Bootstrap: if BOOTSTRAP_ADMIN_PASSWORD secret is set and no admin exists yet,
// auto-create the admin user on the first request that touches auth.
// ---------------------------------------------------------------------------

export const maybeBootstrap = async (env: Env): Promise<void> => {
  if (!env.BOOTSTRAP_ADMIN_PASSWORD) return;
  const existing = await env.USERS.get("user:admin");
  if (existing) return;
  const hash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  const record: UserRecord = {
    passwordHash: hash,
    role: "admin",
    createdAt: Date.now(),
  };
  await env.USERS.put("user:admin", JSON.stringify(record));
};

// ---------------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------------

export const handleLoginPage = (request: Request): Response => {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? undefined;
  return new Response(loginPage({ next }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

// ---------------------------------------------------------------------------
// POST /api/auth/login  (form-encoded or JSON body)
// ---------------------------------------------------------------------------

export const handleLogin = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  await maybeBootstrap(env);

  let username: string;
  let password: string;
  let next = "/";

  const ct = request.headers.get("Content-Type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const body = await request.formData();
    username = (body.get("username") as string | null)?.trim() ?? "";
    password = (body.get("password") as string | null) ?? "";
    next = (body.get("next") as string | null) ?? "/";
  } else {
    let body: { username?: string; password?: string; next?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    username = body.username?.trim() ?? "";
    password = body.password ?? "";
    next = body.next ?? "/";
  }

  if (!username || !password) {
    return badCredentials(request, next);
  }

  const record = await env.USERS.get<UserRecord>(`user:${username}`, "json");
  if (!record) {
    return badCredentials(request, next);
  }

  if (!record.passwordHash) {
    return badCredentials(request, next);
  }
  const valid = await verifyPassword(password, record.passwordHash);
  if (!valid) {
    return badCredentials(request, next);
  }

  const token = await createSession(env, username, record.role);

  // Normalise the redirect target — must stay on the same origin.
  const safeNext = next.startsWith("/") ? next : "/";

  // Respond differently for API vs browser callers.
  const isApiCall = (request.headers.get("Accept") ?? "").includes(
    "application/json",
  );
  if (isApiCall) {
    return json({ ok: true, username, role: record.role }, 200);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: safeNext,
      "Set-Cookie": sessionCookieHeader(token),
    },
  });
};

const badCredentials = (request: Request, next: string): Response => {
  const isApiCall = (request.headers.get("Accept") ?? "").includes(
    "application/json",
  );
  if (isApiCall) {
    return json({ error: "Invalid username or password" }, 401);
  }
  return new Response(
    loginPage({ error: "Invalid username or password", next }),
    {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
};

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

export const handleLogout = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === SESSION_COOKIE && v) {
      await deleteSession(env, v);
      break;
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearCookieHeader(),
    },
  });
};

// ---------------------------------------------------------------------------
// GET /api/auth/me  (current user info)
// ---------------------------------------------------------------------------

export const handleMe = (
  _request: Request,
  _env: Env,
  auth: AuthContext,
): Response => json({ username: auth.username, role: auth.role });

// ---------------------------------------------------------------------------
// Admin — Users
//
//  GET  /api/admin/users             → list all users
//  POST /api/admin/users             → create user
//  DELETE /api/admin/users/:username → delete user
//  POST /api/admin/users/:username/password → change password
// ---------------------------------------------------------------------------

export const handleAdminListUsers = async (
  _request: Request,
  env: Env,
): Promise<Response> => {
  const list = await env.USERS.list({ prefix: "user:" });
  const users = list.keys.map((k) => ({ username: k.name.slice(5) }));
  // Load role for each (parallel)
  const full = await Promise.all(
    users.map(async ({ username }) => {
      const rec = await env.USERS.get<UserRecord>(`user:${username}`, "json");
      return { username, role: rec?.role ?? "user", createdAt: rec?.createdAt };
    }),
  );
  return json(full);
};

export const handleAdminCreateUser = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  let body: { username?: string; password?: string; role?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const username = body.username?.trim();
  const password = body.password;
  const role = body.role === "admin" ? "admin" : "user";

  if (!username || !password) {
    return json({ error: "username and password are required" }, 400);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(username)) {
    return json({ error: "username may only contain letters, digits, _ and -" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }

  const existing = await env.USERS.get(`user:${username}`);
  if (existing) {
    return json({ error: "User already exists" }, 409);
  }

  const passwordHash = await hashPassword(password);
  const record: UserRecord = {
    passwordHash,
    role,
    createdAt: Date.now(),
  };
  await env.USERS.put(`user:${username}`, JSON.stringify(record));
  return json({ ok: true, username, role }, 201);
};

export const handleAdminDeleteUser = async (
  _request: Request,
  env: Env,
  username: string,
  auth: AuthContext,
): Promise<Response> => {
  if (username === auth.username) {
    return json({ error: "Cannot delete your own account" }, 400);
  }
  const existing = await env.USERS.get(`user:${username}`);
  if (!existing) {
    return json({ error: "User not found" }, 404);
  }
  await env.USERS.delete(`user:${username}`);
  // Revoke all API keys belonging to this user.
  const keys = await env.APIKEYS.list({ prefix: `apikey:${API_KEY_PREFIX}` });
  await Promise.all(
    keys.keys.map(async (k) => {
      const rec = await env.APIKEYS.get<ApiKeyRecord>(k.name, "json");
      if (rec?.username === username) {
        await env.APIKEYS.delete(k.name);
      }
    }),
  );
  return json({ ok: true });
};

export const handleAdminChangePassword = async (
  request: Request,
  env: Env,
  username: string,
): Promise<Response> => {
  let body: { password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const password = body.password;
  if (!password || password.length < 8) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }
  const existing = await env.USERS.get<UserRecord>(`user:${username}`, "json");
  if (!existing) {
    return json({ error: "User not found" }, 404);
  }
  const passwordHash = await hashPassword(password);
  await env.USERS.put(
    `user:${username}`,
    JSON.stringify({ ...existing, passwordHash }),
  );
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// Admin — API keys
//
//  GET  /api/admin/api-keys        → list keys for current user (admin sees all)
//  POST /api/admin/api-keys        → create key { label }
//  DELETE /api/admin/api-keys/:key → revoke key
// ---------------------------------------------------------------------------

export const handleListApiKeys = async (
  _request: Request,
  env: Env,
  auth: AuthContext,
): Promise<Response> => {
  const all = await env.APIKEYS.list({ prefix: "apikey:" });
  const records = await Promise.all(
    all.keys.map(async (k) => {
      const rec = await env.APIKEYS.get<ApiKeyRecord>(k.name, "json");
      return { key: k.name.slice(8), ...rec };
    }),
  );
  const visible =
    auth.role === "admin"
      ? records
      : records.filter((r) => r.username === auth.username);
  return json(visible);
};

export const handleCreateApiKey = async (
  request: Request,
  env: Env,
  auth: AuthContext,
): Promise<Response> => {
  let body: { label?: string; username?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  // Admins can create keys for other users; regular users only for themselves.
  const targetUsername =
    auth.role === "admin" && body.username ? body.username : auth.username;

  const label = body.label?.trim() || "api key";
  const key = generateApiKey();
  const record: ApiKeyRecord = {
    username: targetUsername,
    label,
    createdAt: Date.now(),
  };
  await env.APIKEYS.put(`apikey:${key}`, JSON.stringify(record));
  return json({ ok: true, key, label, username: targetUsername }, 201);
};

export const handleRevokeApiKey = async (
  _request: Request,
  env: Env,
  key: string,
  auth: AuthContext,
): Promise<Response> => {
  const record = await env.APIKEYS.get<ApiKeyRecord>(`apikey:${key}`, "json");
  if (!record) {
    return json({ error: "Key not found" }, 404);
  }
  if (auth.role !== "admin" && record.username !== auth.username) {
    return json({ error: "Forbidden" }, 403);
  }
  await env.APIKEYS.delete(`apikey:${key}`);
  return json({ ok: true });
};

// ---------------------------------------------------------------------------
// Route dispatcher — called from router.ts
// ---------------------------------------------------------------------------

export const routeAuthRequest = async (
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> => {
  const method = request.method;

  if (path === "/login" && method === "GET") {
    return handleLoginPage(request);
  }
  if (path === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env);
  }
  if (path === "/api/auth/logout" && (method === "POST" || method === "GET")) {
    return handleLogout(request, env);
  }
  if (path === "/api/auth/me" && method === "GET") {
    return requireAuth(request, env, handleMe);
  }

  // --- Admin: users ---
  if (path === "/api/admin/users" && method === "GET") {
    return requireAdmin(request, env, (req, e) =>
      handleAdminListUsers(req, e),
    );
  }
  if (path === "/api/admin/users" && method === "POST") {
    return requireAdmin(request, env, (req, e) =>
      handleAdminCreateUser(req, e),
    );
  }
  const deleteUser = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (deleteUser && method === "DELETE") {
    return requireAdmin(request, env, (req, e, auth) =>
      handleAdminDeleteUser(req, e, deleteUser[1], auth),
    );
  }
  const changePassword = path.match(
    /^\/api\/admin\/users\/([^/]+)\/password$/,
  );
  if (changePassword && method === "POST") {
    return requireAdmin(request, env, (req, e) =>
      handleAdminChangePassword(req, e, changePassword[1]),
    );
  }

  // --- Admin: API keys ---
  if (path === "/api/admin/api-keys" && method === "GET") {
    return requireAuth(request, env, (req, e, auth) =>
      handleListApiKeys(req, e, auth),
    );
  }
  if (path === "/api/admin/api-keys" && method === "POST") {
    return requireAuth(request, env, (req, e, auth) =>
      handleCreateApiKey(req, e, auth),
    );
  }
  const revokeKey = path.match(/^\/api\/admin\/api-keys\/(.+)$/);
  if (revokeKey && method === "DELETE") {
    return requireAuth(request, env, (req, e, auth) =>
      handleRevokeApiKey(req, e, revokeKey[1], auth),
    );
  }

  return null;
};
