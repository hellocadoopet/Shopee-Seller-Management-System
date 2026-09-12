# Shopee Solo

A single-user, multi-shop Shopee Malaysia management dashboard.

**Built for:** owner of Cadoopet / Oreo Pet Shop / Vetmomo / OPS shops.
**Not built for:** multi-tenant SaaS (use shopee-seller-OLD-backup if you ever go SaaS).

## Stack

- **Next.js 15** (App Router) — both frontend and API routes in one
- **Supabase Postgres** — data storage (no Supabase Auth needed)
- **Shopee Open Platform v2** — external API
- **Anthropic Claude Haiku** — optional, for chat reply suggestions

No queue, no separate backend, no multi-tenant auth.

## Project layout

```
app/
  dashboard/              7 tabs: products / orders / chat / vouchers / campaigns / ads / insights
  connect/                Connect a Shopee shop
  api/                    Server-side route handlers (Shopee OAuth, data endpoints)
lib/                      Shared code: Shopee SDK, Supabase, crypto, chatbot
db/schema.sql             Database tables
```

## Setup

```bash
# 1. Install
pnpm install

# 2. Copy env
cp .env.example .env.local
# Fill in your real values

# 3. Apply schema in Supabase SQL editor
# (paste db/schema.sql)

# 4. Run
pnpm dev
```

Then open http://localhost:3000.

## Connecting a shop

1. Click "Connect Shop" — opens Shopee authorization
2. Authorize on Shopee
3. You land back on the dashboard

The OAuth callback is a server-side route handler (`app/api/shopee/callback/route.ts`), so it just works — no browser bouncing.

For local dev, you need an HTTPS public URL for Shopee to redirect to. Use:
```bash
npx localtunnel --port 3000
```
Then update `SHOPEE_REDIRECT_URL` in `.env.local` to `https://your-tunnel.loca.lt/api/shopee/callback` and register the same URL in Shopee Open Platform Console.

## Deploy (later)

Push to GitHub → connect to Vercel → done. No other infrastructure needed.
