import { describe, it, expect } from "vitest";

import { hashPassword, verifyPassword, generateSessionToken, generateApiKey } from "../src/crypto";
import { API_KEY_PREFIX } from "../src/types";

describe("hashPassword / verifyPassword", () => {
  it("verifies correct password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", hash)).toBe(false);
  });

  it("produces different hashes for same password (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("hash is a bcrypt string (includes embedded salt)", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^\$2[ab]\$/);
  });
});

describe("generateSessionToken", () => {
  it("returns a 64-char hex string", () => {
    const t = generateSessionToken();
    expect(t).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns unique values", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});

describe("generateApiKey", () => {
  it(`starts with ${API_KEY_PREFIX}`, () => {
    expect(generateApiKey()).toMatch(new RegExp(`^${API_KEY_PREFIX}`));
  });

  it("returns unique values", () => {
    expect(generateApiKey()).not.toBe(generateApiKey());
  });
});
