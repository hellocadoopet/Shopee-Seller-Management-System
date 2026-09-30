# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-owner, multi-shop dashboard for Shopee Malaysia shops and WhatsApp numbers. React + Vite SPA (`src/`) with a Hono API (`server/app.ts`) that talks to platforms only through adapters (`adapters/`), plus an always-on WhatsApp worker (`worker/`). Not multi-tenant: no users/workspaces, no RLS.

## Deployment

Two hosts, both on **free plans** for now. Accounts belong to `hello@cadoopet.com`; the GitHub repo is `hellocadoopet/Shopee-Seller-Management-System`, deploy branch `master`.

| Host | Runs | Config | Auto-deploy |
| --- | --- | --- | --- |
| **Vercel** (Hobby), project `shopee-seller-management-system` | Static SPA only. `/api/*` is an external rewrite (reverse proxy) to the Railway API service | `vercel.json` | ✅ Git integration, every push to `master` deploys |
| **Railway** (Free), service **api**, domain `api-production-87f5.up.railway.app` | Hono API (`server/index.ts`, Node server) | `server/Dockerfile`; build/deploy settings on the service | ✅ every push to `master` matching its watch patterns (verified 2026-09-30: push → build in ~1s) |
| **Railway** (Free), service **Shopee-Seller-Management-System** (the worker), domain `shopee-seller-management-system-production.up.railway.app` | WhatsApp worker (Baileys sockets) | `worker/Dockerfile`; build/deploy settings on the service | ✅ push trigger live (non-matching pushes show `SKIPPED`); first push-built deploy still to come |

- **Why the proxy:** the browser only ever talks to the Vercel domain, so `app_auth`/OAuth-state cookies stay first-party, `c.redirect("/…")` lands on the SPA, and `SHOPEE_REDIRECT_URL` + the Shopee push URL stay on the Vercel domain (no Shopee Console change). Rewrite caching is forced off (`x-vercel-enable-rewrite-caching: 0`) so logged-in responses are never CDN-cached. `vercel.json` hardcodes the Railway API domain — env vars can't be used in rewrites.
- **Webhook signature:** Shopee signs the public (Vercel) URL but the API sees its Railway host, so `adapters/shopee/webhook.ts` rebuilds the URL on `SHOPEE_REDIRECT_URL`'s origin.
- Railway project `artistic-unity`, environment `production`. **No `railway.json`:** a root one applies to every service built from the repo (it made the api build the worker image), and config-as-code is deprecated (cutoff 2026-12-01). Dockerfile path, health check, watch patterns and restart policy are set on each service (dashboard / Railway MCP `update-service`). Variables added in the dashboard are *staged* until someone clicks Deploy.
- Both services are Dockerfiles built from the repo root; Railway injects `PORT`. API health: `GET /api/health` (public, passes the password gate). Worker health: `GET /health`.
- Watch patterns decide what redeploys: API on `server/ lib/ adapters/ config/` + root package files; worker on `worker/ lib/ adapters/whatsapp/` + root lockfile. A `lib/` change redeploys both; each worker redeploy drops the WhatsApp sockets for a few seconds.
- **Push trigger needs the Railway GitHub App ("Railway App") installed** on `hellocadoopet` with access to this repo — an OAuth "authorized" Railway only allows API/dashboard deploys, pushes are ignored. Services connected before the install need their source reconnected. `checkSuites` is off (no CI to wait for).
- **Worker** has a **volume `wa-sessions` at `/data`** (500 MB) with `WA_SESSIONS_DIR=/data/wa-sessions` (without it every redeploy logs every number out) and one replica only (two copies of one login kick each other off). Vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WA_WORKER_SECRET`, `WA_SESSIONS_DIR`.
- **API** vars: everything in `.env.example` (Shopee, Supabase, `TOKEN_ENCRYPTION_KEY`, LLM keys, `APP_PASSWORD`, `WA_WORKER_URL=https://<worker domain>`, same `WA_WORKER_SECRET`). Never set `MOCK_CHAT`. Vercel needs no env vars any more.
- **What a merge deploys:** Railway diffs the files the push brings into `master` (one commit for a squash merge) against each service's watch patterns; no match → `SKIPPED`. Vercel deploys every push. The three deploy in parallel with no ordering, so an API + worker change can be briefly half-deployed. To redeploy without a code change, use Redeploy in the Railway dashboard (applying a variable change also redeploys).
- **DB migrations are not automated:** run new `db/migrations/NNN_*.sql` in the Supabase SQL editor *before* merging code that reads the new columns/tables.
- **Variables live on the Railway services** (the source of truth; GitHub secrets never reach Railway's GitHub-App builds). `SHOPEE_REDIRECT_URL=https://shopee-seller-management-system.vercel.app/api/shopee/callback` — Vercel domain, not Railway (the OAuth state cookie is on the Vercel domain); it must match Shopee Console, and it's also the origin the webhook signature is checked against. Shopee push URL: `…vercel.app/api/shopee/webhook`. The local `.env` keeps a localtunnel URL for dev.
- `APP_PASSWORD` must be set on the api service: the Railway domain is public and bypasses Vercel, so the gate is its only protection.
- **Free-plan limits:** Railway Free is $1/month of credit; one always-on service burns it in ~10 days (`worker/README.md`), two burn it faster, then services stop. Plan on Railway Hobby. Vercel Hobby is non-commercial per its terms.

## Commands

```bash
npm install
npm run dev       # runs dev:web (Vite :3000) + dev:api (tsx watch, Hono :8787); Vite proxies /api
npm run build     # vite build → dist/
npm run typecheck # tsc --noEmit — the only static check; no linter, no test suite
npm run smoke     # scripts/smoke.ts: calls a public Shopee endpoint to verify HMAC signing (needs .env.local)
npm run check     # scripts/check-api.ts: offline dashboard API suite
cd worker && npm run check   # offline worker harness (worker/scripts/check.ts)
```

Env vars: see `.env.example` / README. `dev:api` and `smoke` load `.env` then `.env.local` (later wins) via `--env-file-if-exists`. `APP_PASSWORD` empty = no login lock (local dev). OAuth callback needs a public HTTPS URL locally (`npx localtunnel --port 3000`, set `SHOPEE_REDIRECT_URL` to it and register in Shopee Console).

DB schema is applied manually in the Supabase SQL editor: `db/schema.sql` (drops and recreates everything — destructive). The DB exists only because Shopee rotates the refresh token on every refresh, so tokens need a writable store (env is read-only on the host) — don't add tables to cache Shopee data. `db/schema.sql` is for fresh installs; changes to an existing DB go in a new numbered `db/migrations/NNN_*.sql`, written to be safe on an existing DB.

## Architecture

**Layout:** `src/main.tsx` holds all routes (react-router); pages fetch `/api/*`. `server/app.ts` is the whole API (one Hono app, `basePath("/api")`, `onError` → JSON 500) and never imports a platform directly. `server/index.ts` serves it with `@hono/node-server` (locally on :8787 behind Vite's proxy; on Railway behind Vercel's rewrite). Server code uses relative imports with `.js` extensions (no `@/` alias) and runs through `tsx`, no bundler. `lib/supabase.ts` is a lazy proxy so missing env fails per request instead of crashing the API at import.

**Adapters:** `adapters/types.ts` is the platform contract — domain models (`Shop`, `Product`, `Order`, `Conversation`, …) and optional capabilities (`connect`, `pairing`, `catalog`, `orders`, `chat`, `promotions`, `ads`, `webhook`). `adapters/factory.ts` is the only place that knows which platforms exist (`REGISTRY`: `shopee`, `whatsapp`); callers use `getAdapter` / `getCapability` and skip shops whose platform lacks a capability. Each platform: `adapters/<platform>/api/` for raw calls, `utils/mappers.ts` into domain models, `config.ts` for its env. `MOCK_CHAT=true` swaps every platform's chat for seeded dev data (`adapters/mock/chat.ts`) — never in production.

**Shops:** one `shops` row per connected shop or number: `id` (our UUID, used everywhere in DB/cookies/URLs), `platform`, `external_id` (the platform's own id — Shopee shop_id, WhatsApp account id), `shop_name`. Unique on `(platform, external_id)`.

**Multi-shop contract:** read routes take `?shop=all` (default) or `?shop=<uuid>`; `lib/shops.ts#perShop(capability, …)` fans out per shop in parallel (a failing shop never sinks the others) and `merge` returns `{ items, errors }` with every row tagged `shop_id`/`shop_name` — always both keys. Write routes (`POST /products`, `POST /chat/send`, `GET /chat/messages`) require an explicit `shop_id` from the row and 400 without it; there is no "current shop" cookie. Frontend: filter in URL via `useShopParam()` (`src/lib/shops.ts`), shop colours fixed by connection order (validated categorical palette), `useFetch`, and `ShopBadge`/`ShopFilter`/`ShopErrors` in `src/components/Shop.tsx`.

**Request flow for shop data:** page → Hono handler → `resolveShops(?shop)` → `perShop` → `getCredentials(shop)` (`lib/tokens.ts`: decrypts tokens, refreshes through the platform's `connect.refresh` when <10 min to expiry; `tokenless` platforms like WhatsApp skip `shop_tokens`) → the adapter's capability → its `api/` call.

**Shopee (`adapters/shopee/`):** `api/client.ts#execute` is the only HTTP path to Shopee Open Platform v2; Shopee returns HTTP 200 with a non-empty `error` on failure, which `execute` turns into `ShopeeApiError`. `utils/signing.ts`: `signPublic` vs `signShop` are the two HMAC-SHA256 bases (`partner_id+path+ts` vs `…+access_token+shop_id`). Host by `SHOPEE_ENV` (`sandbox` / `live` = `partner.shopeemobile.com`). Limits the code relies on: order list window ≤15 days and cursor-paginated (`orders.ts` walks 15-day chunks and follows cursors); detail/base-info calls max 50 IDs. Conversation timestamps are nanoseconds, message timestamps seconds.

**WhatsApp (`adapters/whatsapp/` + `worker/`):** numbers link by QR through the worker (Baileys), which writes `wa_accounts`/`wa_contacts`/`wa_conversations`/`wa_messages`/`wa_directory` (migrations 002/003) and uploads media to the private `media` bucket. The dashboard reads those tables directly (`api/store.ts`), so the inbox works while the worker restarts, and calls the worker (`api/worker.ts`, Bearer `WA_WORKER_SECRET`, contract in `contract.ts`) only to pair and send. Baileys lives in `worker/package.json`, not the root, so the API image never installs it.

**All data is live:** every Shopee tab calls Shopee per request — don't add tables to cache Shopee data. Insights is capped at 30 days (`MAX_INSIGHT_DAYS` in `server/app.ts`); `lib/analytics.ts` computes basket pairs and order-size buckets in memory.

**Overview (`/api/overview`):** per shop, independent sections (today's sales, chats, products/low stock) each `{ ok: true, data } | { ok: false, error }` or `null` when the platform lacks the capability, so one failure only blanks its own card. "Today" is Malaysia time (UTC+8). Sales exclude `UNPAID`/`IN_CANCEL`/`CANCELLED`.

**Secrets at rest:** platform tokens (`shop_tokens`) are AES-256-GCM encrypted via `lib/crypto.ts` using `TOKEN_ENCRYPTION_KEY` — changing it orphans every stored token. Supabase is accessed server-side only with the service-role key (`lib/supabase.ts`) — never import it into client components.

**Auth gate:** Hono middleware in `server/app.ts` + `lib/appAuth.ts`. Cookie `app_auth` = HMAC(`TOKEN_ENCRYPTION_KEY`, `APP_PASSWORD`). The gate protects `/api/*` only (401); the SPA's `RequireAuth` calls `/api/session` and redirects to `/login` on 401 — static assets are public. Public without login: `/api/login`, `/api/logout`, `/api/health`, and `/api/<platform>/callback|webhook` (platforms call them). OAuth CSRF state uses a short-lived httpOnly cookie, not a DB table.

**Chat replies (`lib/chatbot.ts`):** keyword/regex rules from `config/chatbot.json` (`rules`, first match wins) first; if none match, `suggestReply` calls the LLM with `tone_examples` from the same file as few-shot examples. Replies are suggestions only — never auto-send; the user clicks Send.

**LLM providers (`lib/llm.ts`):** Claude via `@anthropic-ai/sdk`; OpenAI and DeepSeek share one OpenAI-compatible `fetch` path. Provider/model from env (`LLM_PROVIDER`, `LLM_MODEL`) via `getLlmConfig()`, one key per provider (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`, mapped in `KEY_ENV`); the Settings page is read-only plus a test button.

**Webhook (`/api/<platform>/webhook`):** Shopee's verifies the HMAC signature (`url|body`, URL rebuilt on `SHOPEE_REDIRECT_URL`'s origin) with timing-safe compare, then currently only logs; routing by push code is TODO.

## Known gaps (from README)

Chat is assistant-mode only; Ads performance report endpoint not wired; variant products show "variants" instead of per-model prices (products route only reads `price_info[0]`); vouchers are list-only.
