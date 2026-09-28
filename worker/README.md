# WhatsApp worker

An always-on Node process that holds the WhatsApp (Baileys) sockets. Vercel functions can't keep a
socket open, so this runs separately — as its own Railway service (the dashboard API is
a second Railway service, `server/Dockerfile`).

- Writes `wa_accounts`, `wa_contacts`, `wa_conversations`, `wa_messages` (see
  `db/migrations/002_whatsapp.sql`) and, when a number finishes pairing, its `shops` row.
- Uploads live media (≤ 25 MB) to the private Storage bucket `media` under `whatsapp/…`.
- Serves the small HTTP API in `adapters/whatsapp/contract.ts`: pairing (QR), sending, health.
  The dashboard reads the tables directly and calls this API **over HTTPS with the shared secret**
  (`Authorization: Bearer $WA_WORKER_SECRET`) only for things that need the live socket.

Layout: `index.ts` (boot) · `http.ts` (routes + auth) · `wa/manager.ts` (pairing, resume, watchdog,
send) · `wa/baileys-session.ts` (one socket) · `wa/persistence.ts`, `wa/history.ts`, `wa/media.ts`
(DB/Storage writes) · `scripts/check.ts` (offline test harness).

## Env

| Var | Default | |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | — | Same as the dashboard (read via `lib/config.ts`). |
| `WA_WORKER_SECRET` | — | Required; the worker refuses to start without it. Long random string, same value in the dashboard's env. |
| `WA_SESSIONS_DIR` | `worker/wa-sessions` | One login folder per number. **Back it up / keep it on a persistent disk** — losing it means re-scanning QRs. |
| `WA_WORKER_PORT` | `4100` | (The old wa-manager worker uses 4000 on the same VPS.) |
| `LOG_LEVEL`, `BAILEYS_LOG_LEVEL` | `info`, `warn` | Logs are JSON, ids/statuses only — no message bodies or phone numbers. |

`npm run dev` / `npm start` load `../.env.local` if it exists.

## Deploy on Railway

The service builds `worker/Dockerfile` and health-checks `GET /health` (set on the service; there is
no `railway.json`, a root one would apply to the api service too). Watch patterns make it only
redeploy when `worker/`, `lib/`, `adapters/whatsapp/` or the root lockfile change — each redeploy
drops the sockets for a few seconds, so dashboard-only pushes shouldn't restart it.

1. Hobby plan (the free plan's $1 credit runs out in ~10 days and stops the service).
2. New service → Deploy from GitHub repo → this repo, branch you deploy from. Root directory: repo root.
3. **Add a volume mounted at `/data`** — the login folders live there. Without it every redeploy logs
   every number out.
4. Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WA_WORKER_SECRET`,
   `WA_SESSIONS_DIR=/data/wa-sessions`. Don't set a port — Railway injects `PORT` and the worker uses it.
5. Settings → Networking → Generate domain. Put `https://<that domain>` in the dashboard's
   `WA_WORKER_URL` (Railway api service), with the same `WA_WORKER_SECRET`.

Keep it at one replica — Railway refuses replicas on a service with a volume anyway, which is what
we want: two copies of one WhatsApp login would keep kicking each other off.

## Run

```sh
npm ci                        # repo root: hono, @hono/node-server, supabase-js, tsx
cd worker
npm ci --allow-git=all        # Baileys pulls libsignal from GitHub; npm ≥ 12 blocks git deps by default
npm run check                 # offline harness, no WhatsApp needed
npm start
```

Under pm2 (from `worker/`):

```sh
pm2 start npm --name wa-worker -- start
pm2 save && pm2 startup       # survive reboots
pm2 logs wa-worker
```

Put it behind HTTPS (e.g. Caddy/nginx reverse proxy to `127.0.0.1:4100`) — the secret must never
travel over plain HTTP. `GET /health` is public; everything else needs the bearer token.

Baileys is deliberately **not** in the root `package.json`: the API image and Vercel install only the root package.
