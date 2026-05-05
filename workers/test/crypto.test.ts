import { describe, it, expect } from "vitest";

import { hashPassword, verifyPassword, generateSessionToken, generateApiKey } from "../src/crypto";
import { API_KEY_PREFIX } from "../src/types";

describe("hashPassword / verifyPassword", () => {
  it("verifies correct password", async () => {
    const { hash, salt } = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash, salt)).toBe(true);
  });

  it("rejects wrong password", async () => {
    const { hash, salt } = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", hash, salt)).toBe(false);
  });

  it("produces different hashes for same password (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hash is a 64-char hex string", async () => {
    const { hash, salt } = await hashPassword("x");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
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
