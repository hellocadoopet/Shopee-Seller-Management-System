# Shopee Seller Management System

A personal, multi-shop dashboard for managing Shopee Malaysia shops from one place —
products, orders, customer chat (with AI replies), vouchers, ads, and sales insights.

Built for the owner of **Cadoopet, Oreo Pet Shop, Vetmomo, and OPS** shops.
Single owner, multiple shops. Not a multi-tenant SaaS.

---

## What it does

| Tab | What you can do | Notes |
|---|---|---|
| **Overview** | Paid orders + revenue today (MY time), unread chats, product count, low-stock list | Live from Shopee; each card loads independently |
| **Products** | List items, see price + stock, **edit price inline** | Editing writes to real Shopee |
| **Orders** | Orders from the last 14 days | Live from Shopee |
| **Chat** | One inbox across all shops: open a thread → AI-drafted reply → edit → send | You approve before sending; replies go out from the conversation's own shop |
| **Vouchers** | List shop vouchers & discounts | Create coming next |
| **Campaigns** | View Shopee campaign join status | Read-only (Shopee-run) |
| **Ads** | Ad performance table | Read-only; report endpoint WIP |
| **Insights** | Sales by product, market-basket pairs, order-size distribution | Last 30 days, computed live from Shopee |
| **Settings** | Shows which AI is configured + test button | Set via env vars |

### Multiple shops
- A **shop filter** sits at the top of every page: **All shops** (default) or one shop. It lives in the URL (`?shop=`), so each browser tab keeps its own view and links are shareable.
- In "All shops" view every row carries a coloured **shop badge**; Overview adds a per-shop breakdown.
- **Edits always target the row's own shop** (price edits, chat replies) — never whatever the filter says.
- If one shop fails (e.g. its token expired), a red banner names it and the other shops still load.

### AI customer replies
- **Rules first:** keyword → template (instant, free). Rules live in `config/chatbot.json`.
- **Then AI:** if no rule matches, the AI drafts a reply, copying the tone of the `tone_examples` in `config/chatbot.json`.
- **You approve:** the AI never auto-sends — you click Send. (Assistant mode.)
- **Your choice of AI:** Claude, ChatGPT (OpenAI), or DeepSeek — set `LLM_PROVIDER` + that provider's key in env (keep all three keys, switch with one variable).

---

## Tech stack

| Layer | Tech |
|---|---|
| Pages | React 19 + Vite (single-page app, react-router) |
| API | Hono — runs as one Vercel function in prod, a Node server in dev |
| Database | Supabase (Postgres) — only connected shops + their tokens |
| Hosting | Vercel (frontend + API together) |
| Platforms | Shopee Open Platform v2; WhatsApp via Baileys (linked device, QR) — one adapter each |
| AI | Claude / OpenAI / DeepSeek (pick one) |

No message queue, no Redis, no separate worker service. Simple on purpose.

---

## How to run it locally

```bash
# 1. Install dependencies
npm install

# 2. Create your secrets file (.env and/or .env.local — .env.local wins)
cp .env.example .env.local
# then fill in the values (see below)

# 3. Set up the database (once)
# Open Supabase SQL editor and run db/schema.sql

# 4. Start the app (Vite on :3000, API on :8787 — Vite proxies /api)
npm run dev
# open http://localhost:3000
```

### Environment variables (`.env.local`)

| Key | What it is |
|---|---|
| `SHOPEE_PARTNER_ID` | From open.shopee.com |
| `SHOPEE_PARTNER_KEY` | Secret — from open.shopee.com |
| `SHOPEE_ENV` | `sandbox` (testing) or `live` (real shops) |
| `SHOPEE_REDIRECT_URL` | `https://<your-domain>/api/shopee/callback` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (server only) |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 — encrypts stored Shopee tokens |
| `LOW_STOCK_THRESHOLD` | Optional — Overview flags items at or below this stock (default 5) |
| `MOCK_CHAT` | Dev only — `true` serves seeded buyer chats (sandbox has none). Never set in production |
| `APP_PASSWORD` | Login password for the app. **Empty = no lock (local dev).** |
| `LLM_PROVIDER` | Optional — which AI writes chat replies: `claude` (default), `openai`, or `deepseek` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | Optional — one key per provider; only the one `LLM_PROVIDER` picks is used |
| `LLM_MODEL` | Optional — leave empty for the provider default |

> `.env.local` is never uploaded to GitHub (it's in `.gitignore`). Each person recreates it locally.

### Connecting a shop (local)
Shopee needs a public HTTPS address to redirect back to. For local testing:
```bash
npx localtunnel --port 3000
```
Put the tunnel URL in `SHOPEE_REDIRECT_URL` and register the same URL in Shopee Console.
**Once deployed to Vercel, you use the permanent Vercel URL instead — no tunnel needed.**

---

## Deploying (Vercel)

1. Push to GitHub (already done).
2. Vercel → New Project → import this repo.
3. Add all the env vars above in Vercel's **Environment Variables**.
4. Deploy → get a permanent URL like `https://....vercel.app`.
5. Set `SHOPEE_REDIRECT_URL` to `https://<vercel-url>/api/shopee/callback` and register the same in Shopee Console.
6. Set `APP_PASSWORD` in Vercel to lock the app before using real shops.

Every `git push` auto-deploys.

---

## For team members

- **To edit the code:** you're invited as a collaborator. Clone the repo, `npm install`, create your own `.env.local`, edit, then push. Vercel auto-deploys.
- **To use the app:** open the live URL and enter the shared password.
- **Do not** put this project inside Google Drive/OneDrive — `node_modules` breaks their sync. Use a normal folder; GitHub is the backup.

---

## Current status (as of 2026-09-22)

**Working**
- ✅ Shopee partner account approved (sandbox / "Developing" stage)
- ✅ App fully built: all tabs, multi-shop switcher, AI settings, password lock
- ✅ Shopee signing verified; OAuth flow reaches Shopee login
- ✅ Code type-checks clean; pushed to GitHub (private)

**In progress / next**
- ⏳ Finish connecting a **sandbox test shop** (Console → Tools → Test Account-Sandbox) to see live data flow
- ⏳ Deploy to Vercel (permanent URL)
- ⏳ Apply for **Go-Live** to connect the real shops (Cadoopet, Oreo, Vetmomo, OPS)

**Known limitations**
- Chat is **assistant mode** (you approve each reply) — no full auto-reply yet
- Ads tab is read-only and its performance-report endpoint still needs wiring
- Variant-product prices show "variants" (per-variant editing comes later)

---

## Project layout

```
src/                  React app — pages/ (tabs, login, connect), components/, main.tsx (routes)
server/app.ts         Hono API — every /api route + the password gate; talks only to the adapter factory
server/dev.ts         Local API server (:8787)
api/index.ts          Vercel function entry (wraps server/app.ts)
adapters/
  types.ts            The platform contract: domain models (Product, Order, Conversation, …) + capabilities
  factory.ts          The only place that knows which platforms exist: getAdapter / getCapability
  shopee/
    index.ts          Shopee adapter — wires the capabilities below together
    api/              Thin typed wrappers over Shopee endpoints (client, auth, product, order, chat, marketing)
    utils/            Request signing, raw → domain mappers, timestamp units
    connect.ts …      One file per capability: connect, catalog, orders, chat, marketing, webhook
  whatsapp/           WhatsApp adapter — reads the worker's tables, sends/pairs through the worker;
                      contract.ts is the dashboard ↔ worker contract (tables, HTTP API, media paths)
  mock/chat.ts        Seeded dev chat, swapped in for any platform when MOCK_CHAT=true
worker/               Always-on WhatsApp worker (Baileys sockets) — runs on a VPS, not Vercel. See worker/README.md
lib/                  Platform-neutral core: Supabase, crypto, tokens, shops fan-out, analytics, chatbot, AI
db/schema.sql         Fresh-install schema (shops + tokens); db/migrations/ for existing databases
config/chatbot.json   Chat reply rules + AI tone examples
vercel.json           /api/* → function, everything else → index.html
```

### Platforms (adapters)
Every platform implements `PlatformAdapter` from `adapters/types.ts`. A platform only declares the
capabilities it has — `connect`, `catalog`, `orders`, `chat`, `promotions`, `ads`, `webhook` — and
pages skip shops whose platform lacks a feature (a WhatsApp number never shows up on Products).
Routes and pages see only the domain models, never a platform's raw API.

Connect and webhooks are one set of routes for every platform: `/api/<platform>/authorize`,
`/api/<platform>/callback`, `/api/<platform>/webhook`. Shopee's redirect stays `/api/shopee/callback`.

### WhatsApp
WhatsApp links like WhatsApp Web: Connect → "Link WhatsApp by QR code" → scan with the phone
(Settings → Linked devices). It uses Baileys — the *unofficial* linked-device protocol, the same
path the old wa-manager used — so an always-on process must hold each number's socket: the
**worker** (`worker/`), deployed to a VPS. The worker writes `wa_*` tables
(`db/migrations/002_whatsapp.sql`) and uploads media to the private `media` bucket
(`whatsapp/<account>/<conversation>/<message>.<ext>`); the dashboard reads those directly, so the
inbox keeps working while the worker restarts, and calls the worker only to pair and to send.

Scope: see and reply to 1:1 chats (text replies; incoming images, video, voice notes and documents
are shown). Full chat history is synced when a number links; history media shows as a placeholder.
Not ported from wa-manager: campaigns, auto-reply, AI agents, flows, follow-ups, CRM, kanban, tags,
team logins. Needs `WA_WORKER_URL` + `WA_WORKER_SECRET` on Vercel (same secret on the worker).

**Adding a platform** (e.g. Lazada):
1. Create `adapters/lazada/` — `api/` for raw calls, `utils/mappers.ts` to map into domain models,
   one file per capability, and `index.ts` exporting the adapter.
2. Add `"lazada"` to `PlatformId` in `adapters/types.ts` and register it in `adapters/factory.ts`.
3. Add its env vars to `.env.example`. Nothing in `server/` or `src/` needs to change.

Backend imports end in `.js` (`import { x } from "./y.js"`) even though the files are `.ts`:
plain Node ESM — what the Vercel function runs — needs the extension, and TypeScript maps it back.
