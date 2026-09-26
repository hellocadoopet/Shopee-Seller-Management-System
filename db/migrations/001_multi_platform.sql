-- Multi-platform shops: key shops by (platform, external_id) instead of shopee_shop_id, and
-- allow tokens that never expire / have no refresh token (e.g. WhatsApp).
-- Keeps existing rows: every current shop becomes platform 'shopee'.
-- Run once in the Supabase SQL editor, BEFORE deploying the adapter-based code.

begin;

alter table shops add column platform text not null default 'shopee';
alter table shops add column external_id text;
update shops set external_id = shopee_shop_id::text;
alter table shops alter column external_id set not null;
alter table shops alter column platform drop default;
alter table shops add constraint shops_platform_external_id_key unique (platform, external_id);
alter table shops drop column shopee_shop_id;

alter table shop_tokens alter column refresh_token_enc drop not null;
alter table shop_tokens alter column access_expires_at drop not null;
alter table shop_tokens alter column refresh_expires_at drop not null;

commit;
