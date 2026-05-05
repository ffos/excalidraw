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
import type { Env } from "./types";

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Dispatches /api/* to the right handler. Returns null for paths the API
 * doesn't own, so the caller can fall through to static assets.
 */
export const route = async (
  request: Request,
  env: Env,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

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

  if (path.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return null;
};
