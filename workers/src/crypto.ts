import { API_KEY_PREFIX } from "./types";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const DERIVED_BITS = 256;

const toHex = (buf: Uint8Array<ArrayBuffer>): string =>
  [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out as Uint8Array<ArrayBuffer>;
};

/** Constant-time string comparison to prevent timing attacks. */
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
};

export const hashPassword = async (
  password: string,
): Promise<{ hash: string; salt: string }> => {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    DERIVED_BITS,
  );
  return { hash: toHex(new Uint8Array(bits) as Uint8Array<ArrayBuffer>), salt: toHex(saltBytes) };
};

export const verifyPassword = async (
  password: string,
  storedHash: string,
  storedSalt: string,
): Promise<boolean> => {
  const saltBytes = fromHex(storedSalt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    DERIVED_BITS,
  );
  const derived = toHex(new Uint8Array(bits) as Uint8Array<ArrayBuffer>);
  return timingSafeEqual(derived, storedHash);
};

const randomHex = (bytes: number): string =>
  toHex(crypto.getRandomValues(new Uint8Array(bytes)) as Uint8Array<ArrayBuffer>);

export const generateSessionToken = (): string => randomHex(32);

export const generateApiKey = (): string => `${API_KEY_PREFIX}${randomHex(32)}`;
