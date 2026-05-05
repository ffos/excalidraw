# Self-hosting Excalidraw on Cloudflare

This guide walks you through deploying Excalidraw entirely on Cloudflare with no
Firebase or external Socket.io server.

**What you get:**

| Feature | Powered by |
|---|---|
| Static SPA | Cloudflare Pages |
| Scene share links | Cloudflare Worker + KV |
| Image/file storage | Cloudflare R2 |
| Real-time collaboration | Cloudflare Durable Objects (WebSocket) |
| Collab scene persistence | Durable Object storage |

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

### KV namespace (scene share links)

```bash
wrangler kv namespace create SCENES
# → Created namespace "SCENES" with ID: <KV_ID>

wrangler kv namespace create SCENES --preview
# → Created preview namespace with ID: <KV_PREVIEW_ID>
```

### R2 bucket (image files)

```bash
wrangler r2 bucket create excalidraw-files
# preview bucket (used by wrangler dev)
wrangler r2 bucket create excalidraw-files-preview
```

### Durable Object (collab rooms)

No pre-creation needed — the DO class is declared in `wrangler.toml` and
Cloudflare creates instances on first use.

---

## Step 3 — Fill in `wrangler.toml`

Open `wrangler.toml` at the repo root and replace the placeholder IDs:

```toml
[[kv_namespaces]]
binding = "SCENES"
id = "<KV_ID>"               # from Step 2
preview_id = "<KV_PREVIEW_ID>"
```

The R2 bucket names (`excalidraw-files` / `excalidraw-files-preview`) and the
Durable Object binding are already configured correctly if you used the names
above.

---

## Step 4 — Set environment variables

Copy the example env file:

```bash
cp .env.example .env.production
```

Edit `.env.production` and set your Worker's public URL. If you haven't
deployed yet you can come back to this after Step 6 — use a placeholder for
the first build:

```env
VITE_APP_PUBLIC_URL=https://excalidraw.<your-subdomain>.workers.dev
```

All other variables (`VITE_APP_BACKEND_V2_GET_URL`, `VITE_APP_WS_SERVER_URL`,
etc.) are derived from `VITE_APP_PUBLIC_URL` in the example file — leave them
as-is unless you need a custom domain.

To **disable** the Excalidraw+ export button (recommended for self-hosters):

```env
VITE_APP_PLUS_APP=
```

---

## Step 5 — Build the frontend

```bash
cd excalidraw-app
yarn build:app
cd ..
```

The output lands in `excalidraw-app/build/`.

---

## Step 6 — Deploy

Deploy the Worker (API + Durable Objects) and the static assets together:

```bash
wrangler deploy
```

Wrangler reads `wrangler.toml`, uploads the worker bundle, registers the
Durable Object migration, and serves the static `excalidraw-app/build/`
directory via Workers Sites.

On the first deploy Cloudflare will print your Worker's URL:

```
https://excalidraw-worker.<your-account>.workers.dev
```

If this differs from what you put in `.env.production`, update it, rebuild
(`yarn build:app`), and redeploy (`wrangler deploy`) once more.

---

## Step 7 — Smoke-test

1. **Open** `https://excalidraw-worker.<your-account>.workers.dev` — you should
   see the Excalidraw canvas.

2. **Share link** — draw something, click the share/link icon, copy the link,
   open it in a new tab. The drawing should reload.

3. **Collaboration** — open the collab menu, start a session, open the live URL
   in a second browser window. Cursors and edits should appear in real-time on
   both sides.

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

Run the Worker locally with live reload against the real KV/R2/DO emulators:

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

---

## Updating

Pull the latest changes, reinstall deps, rebuild, and redeploy:

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
the Wrangler dashboard or a scheduled Cron Worker if you want automatic
cleanup.
