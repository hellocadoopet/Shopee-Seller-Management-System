-- Shopee Solo — simple Postgres schema for single-user multi-shop setup.
-- No workspaces, no auth.users references, no RLS (we use service_role only).
-- Run this in Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- Drop old tables from the SaaS version (clean slate)
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

-- ─────────────────────────────────────────────────────────────
-- PRODUCTS (cached from Shopee)
-- ─────────────────────────────────────────────────────────────
create table shopee_items (
  shop_id uuid not null references shops(id) on delete cascade,
  item_id bigint not null,
  item_name text not null,
  item_sku text,
  item_status text not null,
  has_model boolean not null default false,
  raw jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (shop_id, item_id)
);

create table shopee_item_models (
  shop_id uuid not null references shops(id) on delete cascade,
  item_id bigint not null,
  model_id bigint not null,
  model_sku text,
  current_price numeric(12, 2),
  original_price numeric(12, 2),
  stock integer,
  primary key (shop_id, item_id, model_id)
);

-- ─────────────────────────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────────────────────────
create table shopee_orders (
  shop_id uuid not null references shops(id) on delete cascade,
  order_sn text not null,
  order_status text not null,
  total_amount numeric(12, 2) not null,
  currency text not null default 'MYR',
  buyer_user_id bigint,
  buyer_username text,
  created_at_shopee timestamptz not null,
  updated_at_shopee timestamptz not null,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (shop_id, order_sn)
);

create index idx_orders_status on shopee_orders(shop_id, order_status);
create index idx_orders_created on shopee_orders(shop_id, created_at_shopee desc);

create table shopee_order_items (
  shop_id uuid not null references shops(id) on delete cascade,
  order_sn text not null,
  item_id bigint not null,
  model_id bigint not null default 0,
  item_name text,
  item_sku text,
  model_sku text,
  qty integer not null,
  unit_price numeric(12, 2) not null,
  discounted_price numeric(12, 2) not null,
  primary key (shop_id, order_sn, item_id, model_id)
);

-- ─────────────────────────────────────────────────────────────
-- CHAT
-- ─────────────────────────────────────────────────────────────
create table shopee_conversations (
  shop_id uuid not null references shops(id) on delete cascade,
  conversation_id text not null,
  buyer_user_id bigint not null,
  buyer_username text,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  primary key (shop_id, conversation_id)
);

create table shopee_messages (
  shop_id uuid not null references shops(id) on delete cascade,
  message_id text not null,
  conversation_id text not null,
  sender text not null check (sender in ('buyer', 'seller', 'bot')),
  message_type text not null,
  content jsonb not null,
  created_at_shopee timestamptz not null,
  primary key (shop_id, message_id)
);

create table chatbot_rules (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  trigger_keywords text[] not null,
  match_mode text not null default 'any' check (match_mode in ('any', 'all', 'regex')),
  reply_template text not null,
  active boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now()
);

create table chatbot_replies (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  conversation_id text not null,
  triggered_by text not null check (triggered_by in ('rule', 'llm', 'manual')),
  rule_id uuid references chatbot_rules(id) on delete set null,
  reply_text text not null,
  sent_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- VOUCHERS (light cache)
-- ─────────────────────────────────────────────────────────────
create table shopee_vouchers (
  shop_id uuid not null references shops(id) on delete cascade,
  voucher_id bigint not null,
  voucher_code text not null,
  voucher_name text not null,
  reward_type integer not null,
  discount_amount numeric(12, 2),
  percentage integer,
  start_time timestamptz not null,
  end_time timestamptz not null,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  primary key (shop_id, voucher_id)
);

-- (OAuth CSRF state is handled with a short-lived httpOnly cookie in the app,
--  so no database table is needed for it.)

-- ─────────────────────────────────────────────────────────────
-- APP SETTINGS (single row) — which AI powers chat replies
-- ─────────────────────────────────────────────────────────────
create table app_settings (
  id int primary key default 1,
  llm_provider text not null default 'claude',   -- claude | openai | deepseek
  llm_api_key_enc text,                           -- encrypted API key (AES-256-GCM)
  llm_model text,
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);
insert into app_settings (id, llm_provider) values (1, 'claude') on conflict (id) do nothing;
