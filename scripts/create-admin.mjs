#!/usr/bin/env node
/**
 * Hashes a password with bcrypt (matching workers/src/crypto.ts) and prints
 * the wrangler command to seed the first admin user in the USERS KV namespace.
 *
 * Usage:
 *   node scripts/create-admin.mjs <password>
 *
 * Requires Node 18+ and that workers/ deps are installed:
 *   cd workers && yarn install
 */

import bcrypt from "./workers/node_modules/bcryptjs/index.js";

const password = process.argv[2];

if (!password || password.length < 8) {
  console.error(
    "Error: password is required and must be at least 8 characters.\n" +
    "Usage: node scripts/create-admin.mjs <password>",
  );
  process.exit(1);
}

if (password.length > 72) {
  console.warn(
    "Warning: bcrypt truncates passwords at 72 bytes. " +
    "Extra characters beyond 72 bytes are ignored.",
  );
}

const hash = await bcrypt.hash(password, 10);

const record = JSON.stringify({
  passwordHash: hash,
  role: "admin",
  createdAt: Date.now(),
});

console.log("\nRun the following command to create the admin user:\n");
console.log(`  wrangler kv key put --binding=USERS "user:admin" '${record}'\n`);
console.log(
  "The key is effective immediately — no redeployment required.\n",
);
