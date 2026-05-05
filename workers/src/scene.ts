import { SCENE_ID_BYTES, SCENE_MAX_BYTES, type Env } from "./types";

const SCENE_ID_RE = /^[a-f0-9]+$/;

const generateSceneId = (): string => {
  const buf = new Uint8Array(SCENE_ID_BYTES);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const corsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

export const handleScenePost = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const origin = request.headers.get("Origin");

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > SCENE_MAX_BYTES) {
    return new Response(
      JSON.stringify({ error_class: "RequestTooLargeError" }),
      {
        status: 413,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    );
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return new Response(JSON.stringify({ error: "empty body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
  if (body.byteLength > SCENE_MAX_BYTES) {
    return new Response(
      JSON.stringify({ error_class: "RequestTooLargeError" }),
      {
        status: 413,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders(origin),
        },
      },
    );
  }

  const id = generateSceneId();
  await env.SCENES.put(id, body);

  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
};

export const handleSceneGet = async (
  request: Request,
  env: Env,
  id: string,
): Promise<Response> => {
  const origin = request.headers.get("Origin");

  if (!SCENE_ID_RE.test(id) || id.length !== SCENE_ID_BYTES * 2) {
    return new Response("Invalid id", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const value = (await env.SCENES.get(id, "arrayBuffer")) as ArrayBuffer | null;
  if (!value) {
    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(origin),
    });
  }

  return new Response(value, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      ...corsHeaders(origin),
    },
  });
};

export const handleSceneOptions = (request: Request): Response => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin")),
  });
};
