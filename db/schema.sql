-- Shopee Solo — the only data we store: connected shops + their Shopee tokens.
-- Everything else (products, orders, chat, vouchers, ads) is read live from Shopee.
-- Tokens need a writable store because Shopee rotates the refresh token on every refresh.
-- No RLS (service_role only). Run this in Supabase SQL editor — it DROPS existing tables.

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
-- SHOPS (one row per Shopee shop you've connected)
-- ─────────────────────────────────────────────────────────────
create table shops (
  id uuid primary key default gen_random_uuid(),
  shopee_shop_id bigint not null unique,
  shop_name text,
  region text not null default 'MY',
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz
);

-- Tokens encrypted at rest (AES-256-GCM). NEVER expose this table client-side.
create table shop_tokens (
  shop_id uuid primary key references shops(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
