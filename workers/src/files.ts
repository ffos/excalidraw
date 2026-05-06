import { FILE_MAX_BYTES, FILE_CACHE_MAX_AGE_SEC, type Env } from "./types";

// Whitelist the path shapes the client uses, to keep arbitrary writes out of R2:
//   files/shareLinks/{shareId}/{fileId}
//   files/rooms/{roomId}/{fileId}
const FILE_PATH_RE =
  /^files\/(shareLinks|rooms)\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;

const corsHeaders = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
  "Access-Control-Max-Age": "86400",
});

const isValidFilePath = (path: string): boolean => FILE_PATH_RE.test(path);

export const handleFilePut = async (
  request: Request,
  env: Env,
  path: string,
): Promise<Response> => {
  const origin = request.headers.get("Origin");

  if (!isValidFilePath(path)) {
    return new Response("Invalid path", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > FILE_MAX_BYTES) {
    return new Response("Payload too large", {
      status: 413,
      headers: corsHeaders(origin),
    });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    return new Response("Empty body", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }
  if (body.byteLength > FILE_MAX_BYTES) {
    return new Response("Payload too large", {
      status: 413,
      headers: corsHeaders(origin),
    });
  }

  await env.FILES.put(path, body, {
    httpMetadata: {
      contentType:
        request.headers.get("Content-Type") || "application/octet-stream",
      cacheControl: `public, max-age=${FILE_CACHE_MAX_AGE_SEC}, immutable`,
    },
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
};

export const handleFileGet = async (
  request: Request,
  env: Env,
  path: string,
): Promise<Response> => {
  const origin = request.headers.get("Origin");

  if (!isValidFilePath(path)) {
    return new Response("Invalid path", {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const obj = await env.FILES.get(path);
  if (!obj) {
    return new Response("Not found", {
      status: 404,
      headers: corsHeaders(origin),
    });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type":
        obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control":
        obj.httpMetadata?.cacheControl ||
        `public, max-age=${FILE_CACHE_MAX_AGE_SEC}, immutable`,
      ...corsHeaders(origin),
    },
  });
};

export const handleFileOptions = (request: Request): Response => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("Origin")),
  });
};
