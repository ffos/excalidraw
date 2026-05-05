#!/usr/bin/env node
/**
 * Hashes a password with PBKDF2 (matching workers/src/crypto.ts) and prints
 * the wrangler command to seed the first admin user in the USERS KV namespace.
 *
 * Usage:
 *   node scripts/create-admin.mjs <password>
 *
 * Then run the printed wrangler command, and finally:
 *   wrangler deploy
 */

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error(
    "Error: password is required and must be at least 8 characters.\n" +
    "Usage: node scripts/create-admin.mjs <password>",
  );
  process.exit(1);
}

// Web Crypto is available in Node 18+, matching the Worker runtime exactly.
const salt = crypto.getRandomValues(new Uint8Array(16));
const saltHex = Array.from(salt)
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);

const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
  key,
  256,
);

const hashHex = Array.from(new Uint8Array(bits))
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");

const record = JSON.stringify({
  passwordHash: hashHex,
  salt: saltHex,
  role: "admin",
  createdAt: Date.now(),
});

console.log("\nRun the following command to create the admin user:\n");
console.log(`  wrangler kv key put --binding=USERS "user:admin" '${record}'\n`);
console.log(
  "Then deploy (or if already deployed the key is effective immediately):\n",
);
console.log("  wrangler deploy\n");
