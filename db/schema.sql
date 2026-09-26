-- Shopee Solo — the only data we store: connected shops (on any platform) + their tokens.
-- Everything else (products, orders, chat, vouchers, ads) is read live from each platform.
-- Tokens need a writable store because Shopee rotates the refresh token on every refresh.
-- No RLS (service_role only). Run this in Supabase SQL editor — it DROPS existing tables.
-- Already have the tables? Run db/migrations/001_multi_platform.sql instead — it keeps your data.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Drop old / no-longer-used tables (clean slate)
-- ─────────────────────────────────────────────────────────────
drop table if exists app_settings cascade;
drop table if exists analytics_order_size cascade;
drop table if exists analytics_basket cascade;
drop table if exists analytics_sales_daily cascade;
drop table if exists shopee_vouchers cascade;
drop table if exists chatbot_replies cascade;
drop table if exists chatbot_rules cascade;
drop table if exists shopee_messages cascade;
drop table if exists shopee_conversations cascade;
drop table if exists shopee_order_items cascade;
drop table if exists shopee_orders cascade;
drop table if exists shopee_item_models cascade;
drop table if exists shopee_items cascade;
drop table if exists shop_tokens cascade;
drop table if exists shops cascade;
drop table if exists workspaces cascade;

-- ─────────────────────────────────────────────────────────────
-- SHOPS (one row per connected account: a Shopee shop, a WhatsApp number, …)
-- ─────────────────────────────────────────────────────────────
create table shops (
  id uuid primary key default gen_random_uuid(),
  platform text not null,          -- adapter id: 'shopee' | 'whatsapp'
  external_id text not null,       -- the platform's own id (Shopee shop_id, WhatsApp phone_number_id)
  shop_name text,
  region text not null default 'MY',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (platform, external_id)
);

-- Tokens encrypted at rest (AES-256-GCM). NEVER expose this table client-side.
-- Expiry / refresh columns are null on platforms whose tokens don't expire.
create table shop_tokens (
  shop_id uuid primary key references shops(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
