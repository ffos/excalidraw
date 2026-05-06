# Self-hosting Excalidraw on Cloudflare

This guide walks you through deploying Excalidraw entirely on Cloudflare with no
Firebase or external Socket.io server.

**What you get:**

| Feature | Powered by |
|---|---|
| Static SPA | Cloudflare Workers Static Assets |
| Scene share links | Cloudflare Worker + KV |
| Image/file storage | Cloudflare R2 |
| Real-time collaboration | Cloudflare Durable Objects (WebSocket) |
| Collab scene persistence | Durable Object storage |
| Authentication (sessions + API keys) | Cloudflare Worker + KV |

All routes are protected by authentication. There is no self-signup — an admin
manages users and API keys. Programmatic access uses `Authorization: Bearer <key>`
headers with API keys that start with `eak_`.

---

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 18–22 and Yarn installed locally
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
  installed and authenticated:

```bash
npm install -g wrangler
wrangler login
```

---

## Step 1 — Clone and install

```bash
git clone https://github.com/<your-fork>/excalidraw.git
cd excalidraw
yarn install
```

---

## Step 2 — Create Cloudflare resources

Run each command and **copy the IDs** it prints — you'll need them in Step 3.

### KV namespace — scene share links

```bash
wrangler kv namespace create SCENES
wrangler kv namespace create SCENES --preview
```

### KV namespaces — authentication

```bash
wrangler kv namespace create USERS
wrangler kv namespace create USERS --preview

wrangler kv namespace create SESSIONS
wrangler kv namespace create SESSIONS --preview

wrangler kv namespace create APIKEYS
wrangler kv namespace create APIKEYS --preview
```

### R2 bucket — image files

```bash
wrangler r2 bucket create excalidraw-files
wrangler r2 bucket create excalidraw-files-preview
```

### Durable Object — collab rooms

No pre-creation needed. The DO class is declared in `wrangler.toml` and
Cloudflare creates instances on first use.

---

## Step 3 — Fill in `wrangler.toml`

Open `wrangler.toml` at the repo root and replace every `<...>` placeholder
with the real IDs printed in Step 2:

```toml
[[kv_namespaces]]
binding = "SCENES"
id = "<SCENES_KV_ID>"
preview_id = "<SCENES_KV_PREVIEW_ID>"

[[kv_namespaces]]
binding = "USERS"
id = "<USERS_KV_ID>"
preview_id = "<USERS_KV_PREVIEW_ID>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<SESSIONS_KV_ID>"
preview_id = "<SESSIONS_KV_PREVIEW_ID>"

[[kv_namespaces]]
binding = "APIKEYS"
id = "<APIKEYS_KV_ID>"
preview_id = "<APIKEYS_KV_PREVIEW_ID>"
```

The R2 bucket names and the Durable Object binding are already configured
correctly if you used the names above.

---

## Step 4 — Set environment variables

Copy the example env file:

```bash
cp .env.example .env.production
```

Edit `.env.production` and set your Worker's public URL (use a placeholder for
the first build if you haven't deployed yet — update and rebuild after Step 6):

```env
VITE_APP_PUBLIC_URL=https://excalidraw.<your-subdomain>.workers.dev
```

All other variables (`VITE_APP_BACKEND_V2_GET_URL`, `VITE_APP_WS_SERVER_URL`,
etc.) are derived from `VITE_APP_PUBLIC_URL` — leave them as-is unless you
need a custom domain.

To **disable** the Excalidraw+ export button (recommended for self-hosters):

```env
VITE_APP_PLUS_APP=
```

---

## Step 5 — Create the first admin user

You have two options:

### Option A — Bootstrap secret (zero-CLI setup)

Set a wrangler secret before deploying. On the first request the Worker will
auto-create an `admin` account and then ignore the secret:

```bash
wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
# Enter a strong password (min 8 chars) when prompted
```

After the first successful login you can delete the secret:

```bash
wrangler secret delete BOOTSTRAP_ADMIN_PASSWORD
```

### Option B — Seed via KV directly

Run the helper script, which hashes the password locally using the same
PBKDF2 algorithm as the Worker:

```bash
node scripts/create-admin.mjs <your-password>
```

Copy the printed `wrangler kv key put` command and run it. The key lands in
KV immediately — no redeployment required.

---

## Step 6 — (Skip to Step 7 — build is combined with deploy)

Build the frontend first (this only needs re-running when the UI changes):

```bash
cd excalidraw-app && yarn build:app && cd ..
```

Then deploy the Worker and bundle the static assets:

```bash
wrangler deploy
```

Wrangler bundles the Worker TypeScript, packages the static assets from
`excalidraw-app/build/` via Workers Static Assets, and uploads everything in a
single request to Cloudflare.

On the first deploy Cloudflare prints your Worker's URL:

```
https://excalidraw-worker.<your-account>.workers.dev
```

If this differs from what you put in `.env.production`, update it, rebuild
(`yarn build:app`), and redeploy (`wrangler deploy`) once more.

---

## Step 8 — First login

1. Open `https://excalidraw-worker.<your-account>.workers.dev` — you are
   redirected to `/login`.
2. Log in with username `admin` and the password you set in Step 5.
3. You are redirected to the Excalidraw canvas.

---

## Step 9 — Smoke-test

1. **Canvas** — draw something, check the toolbar works.

2. **Share link** — click the share icon, copy the link, open in a new tab.
   The drawing should reload (you will need to be logged in).

3. **Collaboration** — start a live session, open the URL in a second browser
   window. Cursors and edits should appear in real-time on both sides.

---

## Managing users and API keys

All admin endpoints require an authenticated admin session (cookie or API key).

### Create a user

```bash
curl -X POST https://your-worker.workers.dev/api/admin/users \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"strongpass1","role":"user"}'
```

### List users

```bash
curl https://your-worker.workers.dev/api/admin/users \
  -H "Authorization: Bearer <admin-api-key>"
```

### Delete a user

```bash
curl -X DELETE https://your-worker.workers.dev/api/admin/users/alice \
  -H "Authorization: Bearer <admin-api-key>"
```

### Change a user's password

```bash
curl -X POST https://your-worker.workers.dev/api/admin/users/alice/password \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"password":"newstrongpass2"}'
```

### Create an API key

Any authenticated user can create a key for themselves. Admins can also create
keys for other users by passing `"username"` in the body.

```bash
curl -X POST https://your-worker.workers.dev/api/admin/api-keys \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"label":"ci-pipeline"}'
```

Response:
```json
{"key":"eak_<64hexchars>","label":"ci-pipeline","username":"admin"}
```

Store the `key` value — it is shown only once.

### List API keys

```bash
curl https://your-worker.workers.dev/api/admin/api-keys \
  -H "Authorization: Bearer <admin-api-key>"
```

Admins see all keys; regular users see only their own.

### Revoke an API key

```bash
curl -X DELETE "https://your-worker.workers.dev/api/admin/api-keys/eak_<key>" \
  -H "Authorization: Bearer <admin-api-key>"
```

### Create the admin's first API key (via cookie session)

```bash
# Log in and capture the session cookie
curl -c cookies.txt -X POST https://your-worker.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}'

# Create a key using the session cookie
curl -b cookies.txt -X POST https://your-worker.workers.dev/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label":"admin-key"}'
```

---

## Custom domain (optional)

In the Cloudflare dashboard go to **Workers & Pages → your worker → Settings →
Triggers → Custom Domains** and add your domain.

Then update `.env.production`:

```env
VITE_APP_PUBLIC_URL=https://excalidraw.example.com
```

Rebuild and redeploy.

---

## Local development

```bash
# Terminal 1 — build the frontend in watch mode
cd excalidraw-app && yarn start

# Terminal 2 — run the worker locally
wrangler dev
```

The Vite dev server (port 3000) proxies `/api/*` to the local Wrangler
instance (port 8787) automatically because both share the same origin during
development.

For local `.env` overrides create `.env.development.local`:

```env
VITE_APP_PUBLIC_URL=http://localhost:8787
VITE_APP_FILES_API_URL=http://localhost:8787/api/files
VITE_APP_ROOMS_API_URL=http://localhost:8787/api/room
VITE_APP_WS_SERVER_URL=http://localhost:8787
```

To set a local bootstrap password for `wrangler dev`:

```bash
echo "BOOTSTRAP_ADMIN_PASSWORD=devpassword" >> .dev.vars
```

---

## Updating

```bash
git pull
yarn install
cd excalidraw-app && yarn build:app && cd ..
wrangler deploy
```

---

## Limits and notes

| Resource | Free tier limit |
|---|---|
| KV reads | 100k/day |
| KV writes | 1k/day |
| R2 storage | 10 GB |
| R2 operations | 1M Class-B reads/month |
| Durable Object requests | 1M/month |
| Worker CPU time | 10 ms/request (bumped to 30s for WebSocket DOs) |

For a small team the free tier is more than sufficient. For larger deployments
consider a paid plan.

Scene share links stored in KV have **no automatic expiry** — add a TTL via
the Wrangler dashboard or a scheduled Cron Worker if you want automatic cleanup.

Sessions expire automatically after 7 days (KV TTL). API keys do not expire —
revoke them explicitly when no longer needed.
