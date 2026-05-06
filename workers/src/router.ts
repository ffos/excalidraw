import {
  handleFileGet,
  handleFileOptions,
  handleFilePut,
} from "./files";
import {
  handleSceneGet,
  handleSceneOptions,
  handleScenePost,
} from "./scene";
import { resolveAuth, requireAdmin } from "./auth";
import { routeAuthRequest } from "./authRoutes";
import type { AuthContext, Env } from "./types";

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Dispatches /api/* and auth routes to the right handler.
 *
 * Returns:
 *  - A Response for auth/API routes
 *  - null for authenticated non-API paths (caller serves static assets)
 *
 * Auth rules:
 *  - /login and /api/auth/*  → public
 *  - everything else         → requires a valid session or API key
 *    • browsers get a redirect to /login
 *    • API callers get 401 JSON
 */
export const route = async (
  request: Request,
  env: Env,
): Promise<Response | null> => {
  const { pathname: path } = new URL(request.url);
  const method = request.method;

  // Public auth routes (login page, login POST, logout, me)
  const authResponse = await routeAuthRequest(request, env, path);
  if (authResponse !== null) return authResponse;

  // All other routes require authentication.
  const auth = await resolveAuth(request, env);
  if (!auth) {
    const acceptsHtml = (request.headers.get("Accept") ?? "").includes("text/html");
    if (acceptsHtml) {
      const next = encodeURIComponent(path);
      return Response.redirect(new URL(`/login?next=${next}`, request.url).toString(), 302);
    }
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only /api/* paths are handled here; everything else falls through to ASSETS.
  if (!path.startsWith("/api/")) {
    return null;
  }

  return routeApi(request, env, auth, path, method);
};

const routeApi = async (
  request: Request,
  env: Env,
  _auth: AuthContext,
  path: string,
  method: string,
): Promise<Response> => {
  // ----- scene share API --------------------------------------------------
  if (path === "/api/v2/post/" || path === "/api/v2/post") {
    if (method === "OPTIONS") return handleSceneOptions(request);
    if (method === "POST") return handleScenePost(request, env);
    return new Response("Method not allowed", { status: 405 });
  }
  const sceneGet = path.match(/^\/api\/v2\/([A-Za-z0-9]+)\/?$/);
  if (sceneGet) {
    if (method === "OPTIONS") return handleSceneOptions(request);
    if (method === "GET") return handleSceneGet(request, env, sceneGet[1]);
    return new Response("Method not allowed", { status: 405 });
  }

  // ----- file storage API -------------------------------------------------
  const filesMatch = path.match(/^\/api\/(files\/.+)$/);
  if (filesMatch) {
    const filePath = filesMatch[1];
    if (method === "OPTIONS") return handleFileOptions(request);
    if (method === "PUT") return handleFilePut(request, env, filePath);
    if (method === "GET") return handleFileGet(request, env, filePath);
    return new Response("Method not allowed", { status: 405 });
  }

  // ----- collab room (Durable Object) ------------------------------------
  const roomMatch = path.match(/^\/api\/room\/([^/]+)\/(ws|scene)\/?$/);
  if (roomMatch) {
    const roomId = roomMatch[1];
    if (!ROOM_ID_RE.test(roomId)) {
      return new Response("Invalid room id", { status: 400 });
    }
    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  }

  return new Response("Not found", { status: 404 });
};

// Re-export for use in authRoutes.ts
export { requireAdmin };
