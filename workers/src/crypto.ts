import bcrypt from "bcryptjs";
import { API_KEY_PREFIX } from "./types";

const BCRYPT_ROUNDS = 10;

/**
 * Hash a password with bcrypt via the well-vetted bcryptjs library.
 * The returned string already contains the embedded salt — no separate
 * salt value is needed.
 *
 * Note: bcrypt silently truncates passwords beyond 72 bytes.
 */
export const hashPassword = (password: string): Promise<string> =>
  bcrypt.hash(password, BCRYPT_ROUNDS);

/** Constant-time bcrypt comparison. */
export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);

const randomHex = (bytes: number): string => {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** 64-char hex session token (32 random bytes). */
export const generateSessionToken = (): string => randomHex(32);

/** `eak_` + 64-char hex (32 random bytes). */
export const generateApiKey = (): string => `${API_KEY_PREFIX}${randomHex(32)}`;
