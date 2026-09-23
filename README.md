# Shopee Seller Management System

A personal, multi-shop dashboard for managing Shopee Malaysia shops from one place —
products, orders, customer chat (with AI replies), vouchers, ads, and sales insights.

Built for the owner of **Cadoopet, Oreo Pet Shop, Vetmomo, and OPS** shops.
Single owner, multiple shops. Not a multi-tenant SaaS.

---

## What it does

| Tab | What you can do | Notes |
|---|---|---|
| **Overview** | Today's orders, revenue, unread chats | Reads synced data |
| **Products** | List items, see price + stock, **edit price inline** | Editing writes to real Shopee |
| **Orders** | Fetch orders (1 / 7 / 30 / 90 days), auto-saves to DB | Powers Insights |
| **Chat** | Paste a buyer message → get an AI-drafted reply → send | You approve before sending |
| **Vouchers** | List shop vouchers & discounts | Create coming next |
| **Campaigns** | View Shopee campaign join status | Read-only (Shopee-run) |
| **Ads** | Ad performance table | Read-only; report endpoint WIP |
| **Insights** | Sales by product, market-basket pairs, order-size distribution | Computed from synced orders |
| **Settings** | Choose AI provider + API key | Claude / ChatGPT / DeepSeek |

### AI customer replies
- **Rules first:** keyword → template (instant, free).
- **Then AI:** if no rule matches, the AI drafts a reply, learning your tone from your past replies.
- **You approve:** the AI never auto-sends — you click Send. (Assistant mode.)
- **Your choice of AI:** Claude, ChatGPT (OpenAI), or DeepSeek — set in Settings with an API key.

---

## Tech stack

| Layer | Tech |
|---|---|
| Pages | React 19 + Vite (single-page app, react-router) |
| API | Hono — runs as one Vercel function in prod, a Node server in dev |
| Database | Supabase (Postgres) |
| Hosting | Vercel (frontend + API together) |
| External API | Shopee Open Platform v2 |
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
# Open Supabase SQL editor and run, in order:
#   db/schema.sql
#   db/02_settings.sql

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
| `APP_PASSWORD` | Login password for the app. **Empty = no lock (local dev).** |
| `ANTHROPIC_API_KEY` | Optional — AI key can also be set in the Settings page |

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
src/                React app — pages/ (tabs, login, connect), components/, main.tsx (routes)
server/app.ts       Hono API — every /api route + the password gate
server/dev.ts       Local API server (:8787)
api/index.ts        Vercel function entry (wraps server/app.ts)
lib/                Shopee client, Supabase, crypto, tokens, chatbot, AI providers, sync
db/                 Database schema + migrations
vercel.json         /api/* → function, everything else → index.html
```
