#!/usr/bin/env node
/**
 * Hashes a password with PBKDF2-SHA256 (matching workers/src/crypto.ts) and
 * prints the wrangler command to seed the first admin user in USERS KV.
 *
 * Usage:
 *   node scripts/create-admin.mjs <password>
 *
 * Requires Node 18+ and that workers/ deps are installed:
 *   cd workers && yarn install
 */

import { pbkdf2 as pbkdf2Sync } from "./workers/node_modules/@noble/hashes/pbkdf2.js";
import { sha256 } from "./workers/node_modules/@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "./workers/node_modules/@noble/hashes/utils.js";

const PBKDF2_ROUNDS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error(
    "Error: password is required and must be at least 8 characters.\n" +
    "Usage: node scripts/create-admin.mjs <password>",
  );
  process.exit(1);
}

const salt = randomBytes(SALT_BYTES);
const hash = pbkdf2Sync(sha256, password, salt, { c: PBKDF2_ROUNDS, dkLen: HASH_BYTES });
const passwordHash = `$pbkdf2-sha256$c=${PBKDF2_ROUNDS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;

const record = JSON.stringify({
  passwordHash,
  role: "admin",
  createdAt: Date.now(),
});

console.log("\nRun the following command to create the admin user:\n");
console.log(`  wrangler kv key put --binding=USERS "user:admin" '${record}'\n`);
console.log("The key is effective immediately — no redeployment required.\n");
