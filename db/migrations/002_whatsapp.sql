-- WhatsApp (Baileys worker) tables. The worker writes them; the dashboard reads them.
-- Each paired number is also a row in `shops` (platform 'whatsapp', external_id = wa_accounts.id),
-- so it shows up next to the Shopee shops in the inbox and shop filter.
-- Run once in the Supabase SQL editor, after 001_multi_platform.sql.

begin;

-- One row per paired WhatsApp number. id is also the worker's wa-sessions/<id>/ folder.
create table wa_accounts (
  id uuid primary key,
  shop_id uuid not null unique references shops(id) on delete cascade,
  phone_number text,
  status text not null default 'connecting', -- connecting | connected | disconnected | logged_out
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- A person who messaged a number. Per account: the same person writing to two numbers is two contacts.
create table wa_contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wa_accounts(id) on delete cascade,
  jid text not null,         -- canonical id (<phone>@s.whatsapp.net) — keeps "@lid" and phone chats as one contact
  routing_jid text,          -- where replies must go: the jid their latest message came from (may be "@lid")
  name text,                 -- WhatsApp push name
  phone_number text,
  unique (account_id, jid)
);

create table wa_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wa_accounts(id) on delete cascade,
  contact_id uuid not null references wa_contacts(id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  unique (account_id, contact_id)
);
create index wa_conversations_recent on wa_conversations (account_id, last_message_at desc);

create table wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  account_id uuid not null references wa_accounts(id) on delete cascade,
  wa_message_id text not null,       -- WhatsApp's own message id
  direction text not null check (direction in ('in', 'out')),
  type text not null default 'text', -- text | image | video | audio | document | sticker | other
  body text,                         -- text, or the caption of a media message
  status text,                       -- out only: sent | delivered | read | failed
  created_at timestamptz not null default now(),
  unique (account_id, wa_message_id) -- dedupe: Baileys can deliver the same message twice
);
create index wa_messages_thread on wa_messages (conversation_id, created_at);

commit;
