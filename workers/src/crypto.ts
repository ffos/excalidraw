import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { API_KEY_PREFIX } from "./types";

const PBKDF2_ROUNDS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

// PHC-inspired single string: $pbkdf2-sha256$c=100000$<hex-salt>$<hex-hash>
// Embedding the salt avoids a separate UserRecord field.
const encode = (hash: Uint8Array, salt: Uint8Array): string =>
  `$pbkdf2-sha256$c=${PBKDF2_ROUNDS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;

const decode = (stored: string): { hash: Uint8Array; salt: Uint8Array } => {
  const parts = stored.split("$");
  // ["", "pbkdf2-sha256", "c=...", hex-salt, hex-hash]
  return { salt: hexToBytes(parts[3]), hash: hexToBytes(parts[4]) };
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/**
 * Hash a password with PBKDF2-SHA256 via @noble/hashes (audited by Cure53).
 * pbkdf2Async delegates to the native Web Crypto API in Workers, so it does
 * not consume JS CPU-time budget. Salt is embedded in the returned string.
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2Async(sha256, password, salt, {
    c: PBKDF2_ROUNDS,
    dkLen: HASH_BYTES,
  });
  return encode(hash, salt);
};

/** Timing-safe verification against an encoded hash string. */
export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<boolean> => {
  const { salt, hash: storedHash } = decode(stored);
  const hash = await pbkdf2Async(sha256, password, salt, {
    c: PBKDF2_ROUNDS,
    dkLen: HASH_BYTES,
  });
  return equalBytes(hash, storedHash);
};

/** 64-char hex session token (32 random bytes, Web Crypto-backed). */
export const generateSessionToken = (): string => bytesToHex(randomBytes(32));

/** `eak_` + 64-char hex API key. */
export const generateApiKey = (): string =>
  `${API_KEY_PREFIX}${bytesToHex(randomBytes(32))}`;
