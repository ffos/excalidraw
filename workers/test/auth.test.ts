import { describe, it, expect, beforeEach, vi } from "vitest";
import * as jose from "jose";

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));

import { resolveAuth, createSession, deleteSession, sessionCookieHeader, clearCookieHeader } from "../src/auth";
import { hashPassword } from "../src/crypto";
import { SESSION_COOKIE } from "../src/types";
import type { Env, UserRecord, ApiKeyRecord } from "../src/types";
import { makeFullEnv } from "./envFactory";

const seedUser = async (env: Env, username: string, role: "admin" | "user" = "user") => {
  const passwordHash = await hashPassword("password123");
  const record: UserRecord = { passwordHash, role, createdAt: Date.now() };
  await env.USERS.put(`user:${username}`, JSON.stringify(record));
};

describe("resolveAuth", () => {
  let env: Env;
  beforeEach(() => { env = makeFullEnv(); });

  it("returns null when no cookie and no header", async () => {
    const req = new Request("https://w/");
    expect(await resolveAuth(req, env)).toBeNull();
  });

  it("resolves a valid session cookie", async () => {
    await seedUser(env, "alice");
    const token = await createSession(env, "alice", "user");
    const req = new Request("https://w/", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    const auth = await resolveAuth(req, env);
    expect(auth).toEqual({ username: "alice", role: "user" });
  });

  it("returns null for an unknown session token", async () => {
    const req = new Request("https://w/", {
      headers: { Cookie: `${SESSION_COOKIE}=deadbeef` },
    });
    expect(await resolveAuth(req, env)).toBeNull();
  });

  it("returns null after session is deleted", async () => {
    await seedUser(env, "bob");
    const token = await createSession(env, "bob", "user");
    await deleteSession(env, token);
    const req = new Request("https://w/", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(await resolveAuth(req, env)).toBeNull();
  });

  it("resolves a valid API key (Bearer header)", async () => {
    await seedUser(env, "carol", "admin");
    const record: ApiKeyRecord = { username: "carol", label: "ci", createdAt: Date.now() };
    await env.APIKEYS.put("apikey:eak_testkey", JSON.stringify(record));
    const req = new Request("https://w/api/v2/test", {
      headers: { Authorization: "Bearer eak_testkey" },
    });
    const auth = await resolveAuth(req, env);
    expect(auth).toEqual({ username: "carol", role: "admin" });
  });

  it("returns null for an invalid API key", async () => {
    const req = new Request("https://w/", {
      headers: { Authorization: "Bearer eak_nosuchkey" },
    });
    expect(await resolveAuth(req, env)).toBeNull();
  });

  it("API key wins over session cookie when both are present", async () => {
    await seedUser(env, "dave");
    await seedUser(env, "eve", "admin");
    const sessionToken = await createSession(env, "dave", "user");
    const record: ApiKeyRecord = { username: "eve", label: "k", createdAt: Date.now() };
    await env.APIKEYS.put("apikey:eak_evekey", JSON.stringify(record));
    const req = new Request("https://w/", {
      headers: {
        Cookie: `${SESSION_COOKIE}=${sessionToken}`,
        Authorization: "Bearer eak_evekey",
      },
    });
    const auth = await resolveAuth(req, env);
    expect(auth?.username).toBe("eve");
  });
});

describe("resolveAuth - CF Access mode", () => {
  it("returns null when CF_ACCESS_AUTH_DOMAIN is set but no assertion header", async () => {
    const env = makeFullEnv({ CF_ACCESS_AUTH_DOMAIN: "team.cloudflareaccess.com" });
    const req = new Request("https://w/");
    expect(await resolveAuth(req, env)).toBeNull();
  });

  it("auto-provisions a new user from a valid JWT and returns user role", async () => {
    const env = makeFullEnv({ CF_ACCESS_AUTH_DOMAIN: "team.cloudflareaccess.com" });
    vi.mocked(jose.createRemoteJWKSet).mockReturnValue({} as ReturnType<typeof jose.createRemoteJWKSet>);
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { email: "alice@example.com" },
      protectedHeader: { alg: "RS256" },
    } as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req = new Request("https://w/", {
      headers: { "Cf-Access-Jwt-Assertion": "fake.jwt.token" },
    });
    const auth = await resolveAuth(req, env);
    expect(auth).toEqual({ username: "alice@example.com", role: "user" });
    // User should be stored in KV
    expect(await env.USERS.get("user:alice@example.com")).not.toBeNull();
  });

  it("respects an existing user's role from USERS KV", async () => {
    const env = makeFullEnv({ CF_ACCESS_AUTH_DOMAIN: "team.cloudflareaccess.com" });
    await env.USERS.put("user:admin@example.com", JSON.stringify({ role: "admin", createdAt: Date.now() }));
    vi.mocked(jose.createRemoteJWKSet).mockReturnValue({} as ReturnType<typeof jose.createRemoteJWKSet>);
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { email: "admin@example.com" },
      protectedHeader: { alg: "RS256" },
    } as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const req = new Request("https://w/", {
      headers: { "Cf-Access-Jwt-Assertion": "fake.jwt.token" },
    });
    const auth = await resolveAuth(req, env);
    expect(auth).toEqual({ username: "admin@example.com", role: "admin" });
  });

  it("returns null when JWT verification fails", async () => {
    const env = makeFullEnv({ CF_ACCESS_AUTH_DOMAIN: "team.cloudflareaccess.com" });
    vi.mocked(jose.createRemoteJWKSet).mockReturnValue({} as ReturnType<typeof jose.createRemoteJWKSet>);
    vi.mocked(jose.jwtVerify).mockRejectedValue(new Error("Invalid signature"));

    const req = new Request("https://w/", {
      headers: { "Cf-Access-Jwt-Assertion": "tampered.jwt.token" },
    });
    expect(await resolveAuth(req, env)).toBeNull();
  });
});

describe("session cookie helpers", () => {
  it("sessionCookieHeader sets HttpOnly and path", () => {
    const h = sessionCookieHeader("tok");
    expect(h).toContain("HttpOnly");
    expect(h).toContain("Path=/");
    expect(h).toContain(`${SESSION_COOKIE}=tok`);
  });

  it("clearCookieHeader sets Max-Age=0", () => {
    const h = clearCookieHeader();
    expect(h).toContain("Max-Age=0");
  });
});
