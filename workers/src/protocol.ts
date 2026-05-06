/**
 * Wire format for the WebSocket envelope used between the client wrapper
 * (workers-aware shim that mimics socket.io's API) and the CollabRoom DO.
 *
 * Each frame is a UTF-8 JSON object:
 *   { "t": "event-name", "a": [arg1, arg2, ...] }
 *
 * Binary args (ArrayBuffer / Uint8Array) are wrapped as { "__b": "<base64>" }
 * so they can travel inside JSON.
 */

export interface Envelope {
  t: string;
  a: unknown[];
}

const isBinaryMarker = (
  v: unknown,
): v is { __b: string } =>
  typeof v === "object" &&
  v !== null &&
  "__b" in v &&
  typeof (v as { __b: unknown }).__b === "string";

const toBase64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in Workers
  return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

export const encodeArg = (v: unknown): unknown => {
  if (v instanceof ArrayBuffer || v instanceof Uint8Array) {
    return { __b: toBase64(v) };
  }
  return v;
};

export const decodeArg = (v: unknown): unknown => {
  if (isBinaryMarker(v)) {
    return fromBase64(v.__b);
  }
  return v;
};

export const encodeEnvelope = (type: string, args: unknown[]): string =>
  JSON.stringify({ t: type, a: args.map(encodeArg) });

export const decodeEnvelope = (data: string): Envelope => {
  const parsed = JSON.parse(data) as { t: unknown; a: unknown };
  if (typeof parsed.t !== "string" || !Array.isArray(parsed.a)) {
    throw new Error("invalid envelope");
  }
  return { t: parsed.t, a: parsed.a.map(decodeArg) };
};
