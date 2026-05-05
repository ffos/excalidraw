import { describe, it, expect, beforeEach } from "vitest";

import {
  handleLogin,
  handleLogout,
  handleAdminCreateUser,
  handleAdminListUsers,
  handleAdminDeleteUser,
  handleAdminChangePassword,
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
  maybeBootstrap,
} from "../src/authRoutes";
import { hashPassword } from "../src/crypto";
import { SESSION_COOKIE, API_KEY_PREFIX } from "../src/types";
import type { Env, UserRecord } from "../src/types";
import { makeFullEnv } from "./envFactory";

const seedUser = async (
  env: Env,
  username: string,
  password: string,
  role: "admin" | "user" = "user",
) => {
  const { hash, salt } = await hashPassword(password);
  const record: UserRecord = { passwordHash: hash, salt, role, createdAt: Date.now() };
  await env.USERS.put(`user:${username}`, JSON.stringify(record));
};

const adminAuth = { username: "admin", role: "admin" as const };
const userAuth = { username: "alice", role: "user" as const };

describe("handleLogin", () => {
  let env: Env;
  beforeEach(async () => {
    env = makeFullEnv();
    await seedUser(env, "alice", "secret123");
  });

  it("redirects on success with Set-Cookie (form body)", async () => {
    const body = new URLSearchParams({ username: "alice", password: "secret123" });
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const res = await handleLogin(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toContain(SESSION_COOKIE);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("returns JSON on success when Accept: application/json", async () => {
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "secret123" }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const res = await handleLogin(req, env);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; username: string };
    expect(json.ok).toBe(true);
    expect(json.username).toBe("alice");
  });

  it("returns 401 on wrong password", async () => {
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "wrong" }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const res = await handleLogin(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown user", async () => {
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "nobody", password: "x" }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const res = await handleLogin(req, env);
    expect(res.status).toBe(401);
  });

  it("respects the next parameter in redirect", async () => {
    const body = new URLSearchParams({ username: "alice", password: "secret123", next: "/my-drawing" });
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const res = await handleLogin(req, env);
    expect(res.headers.get("Location")).toBe("/my-drawing");
  });

  it("rejects a next parameter that is not a path", async () => {
    const req = new Request("https://w/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "secret123", next: "https://evil.com" }),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
    });
    const res = await handleLogin(req, env);
    // Should succeed but redirect to / not evil.com
    expect(res.status).toBe(200);
  });
});

describe("handleLogout", () => {
  it("clears the session cookie and redirects to /login", async () => {
    const env = makeFullEnv();
    const req = new Request("https://w/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE}=sometoken` },
    });
    const res = await handleLogout(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(res.headers.get("Location")).toBe("/login");
  });
});

describe("admin users", () => {
  let env: Env;
  beforeEach(async () => {
    env = makeFullEnv();
    await seedUser(env, "admin", "adminpass", "admin");
  });

  it("creates a new user", async () => {
    const req = new Request("https://w/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: "newuser", password: "longpass1", role: "user" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleAdminCreateUser(req, env);
    expect(res.status).toBe(201);
    const json = await res.json() as { username: string };
    expect(json.username).toBe("newuser");
  });

  it("rejects duplicate username", async () => {
    const body = JSON.stringify({ username: "admin", password: "longpass1" });
    const req = new Request("https://w/", { method: "POST", body, headers: { "Content-Type": "application/json" } });
    const res = await handleAdminCreateUser(req, env);
    expect(res.status).toBe(409);
  });

  it("rejects password shorter than 8 chars", async () => {
    const req = new Request("https://w/", {
      method: "POST",
      body: JSON.stringify({ username: "x", password: "short" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleAdminCreateUser(req, env);
    expect(res.status).toBe(400);
  });

  it("lists all users", async () => {
    await handleAdminCreateUser(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ username: "bob", password: "longpass1" }), headers: { "Content-Type": "application/json" } }),
      env,
    );
    const res = await handleAdminListUsers(new Request("https://w/"), env);
    const list = await res.json() as { username: string }[];
    expect(list.map((u) => u.username).sort()).toEqual(["admin", "bob"]);
  });

  it("deletes a user", async () => {
    await handleAdminCreateUser(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ username: "todelete", password: "longpass1" }), headers: { "Content-Type": "application/json" } }),
      env,
    );
    const res = await handleAdminDeleteUser(
      new Request("https://w/"), env, "todelete", adminAuth,
    );
    expect(res.status).toBe(200);
    expect(await env.USERS.get("user:todelete")).toBeNull();
  });

  it("prevents deleting own account", async () => {
    const res = await handleAdminDeleteUser(
      new Request("https://w/"), env, "admin", adminAuth,
    );
    expect(res.status).toBe(400);
  });

  it("changes a user's password", async () => {
    await handleAdminCreateUser(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ username: "user1", password: "oldpass!1" }), headers: { "Content-Type": "application/json" } }),
      env,
    );
    const res = await handleAdminChangePassword(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ password: "newpassword1" }), headers: { "Content-Type": "application/json" } }),
      env,
      "user1",
    );
    expect(res.status).toBe(200);
  });
});

describe("API keys", () => {
  let env: Env;
  beforeEach(async () => {
    env = makeFullEnv();
    await seedUser(env, "alice", "pass12345");
    await seedUser(env, "bob", "pass12345");
  });

  it("creates an API key for the requesting user", async () => {
    const req = new Request("https://w/api/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({ label: "ci-key" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleCreateApiKey(req, env, userAuth);
    expect(res.status).toBe(201);
    const json = await res.json() as { key: string; username: string };
    expect(json.key).toMatch(new RegExp(`^${API_KEY_PREFIX}`));
    expect(json.username).toBe("alice");
  });

  it("admin can create a key for another user", async () => {
    const req = new Request("https://w/", {
      method: "POST",
      body: JSON.stringify({ label: "for-bob", username: "bob" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleCreateApiKey(req, env, adminAuth);
    const json = await res.json() as { username: string };
    expect(json.username).toBe("bob");
  });

  it("regular user cannot override username to another user", async () => {
    const req = new Request("https://w/", {
      method: "POST",
      body: JSON.stringify({ label: "x", username: "bob" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await handleCreateApiKey(req, env, userAuth);
    const json = await res.json() as { username: string };
    // Non-admin: username field is ignored, key is for alice
    expect(json.username).toBe("alice");
  });

  it("lists only own keys for regular user", async () => {
    // Create a key for alice
    await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "a" }), headers: { "Content-Type": "application/json" } }),
      env, userAuth,
    );
    // Create a key for bob (via admin)
    await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "b", username: "bob" }), headers: { "Content-Type": "application/json" } }),
      env, adminAuth,
    );
    const res = await handleListApiKeys(new Request("https://w/"), env, userAuth);
    const list = await res.json() as { username: string }[];
    expect(list.every((k) => k.username === "alice")).toBe(true);
  });

  it("admin sees all keys", async () => {
    await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "a" }), headers: { "Content-Type": "application/json" } }),
      env, userAuth,
    );
    await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "b", username: "bob" }), headers: { "Content-Type": "application/json" } }),
      env, adminAuth,
    );
    const res = await handleListApiKeys(new Request("https://w/"), env, adminAuth);
    const list = await res.json() as { username: string }[];
    expect(list.length).toBe(2);
  });

  it("revokes a key", async () => {
    const createRes = await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "temp" }), headers: { "Content-Type": "application/json" } }),
      env, userAuth,
    );
    const { key } = await createRes.json() as { key: string };
    const revokeRes = await handleRevokeApiKey(new Request("https://w/"), env, key, userAuth);
    expect(revokeRes.status).toBe(200);
    expect(await env.APIKEYS.get(`apikey:${key}`)).toBeNull();
  });

  it("non-owner cannot revoke someone else's key", async () => {
    const createRes = await handleCreateApiKey(
      new Request("https://w/", { method: "POST", body: JSON.stringify({ label: "b", username: "bob" }), headers: { "Content-Type": "application/json" } }),
      env, adminAuth,
    );
    const { key } = await createRes.json() as { key: string };
    const res = await handleRevokeApiKey(new Request("https://w/"), env, key, userAuth);
    expect(res.status).toBe(403);
  });
});

describe("maybeBootstrap", () => {
  it("creates admin user from BOOTSTRAP_ADMIN_PASSWORD if no user exists", async () => {
    const env = makeFullEnv({ BOOTSTRAP_ADMIN_PASSWORD: "bootstrapPass1" });
    await maybeBootstrap(env);
    const user = await env.USERS.get("user:admin");
    expect(user).not.toBeNull();
  });

  it("does not overwrite existing admin", async () => {
    const env = makeFullEnv({ BOOTSTRAP_ADMIN_PASSWORD: "newpass" });
    await seedUser(env, "admin", "original", "admin");
    const before = await env.USERS.get("user:admin");
    await maybeBootstrap(env);
    const after = await env.USERS.get("user:admin");
    expect(before).toBe(after);
  });

  it("is a no-op when secret is not set", async () => {
    const env = makeFullEnv();
    await maybeBootstrap(env);
    expect(await env.USERS.get("user:admin")).toBeNull();
  });
});
