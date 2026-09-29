-- WhatsApp identities: which hidden "@lid" id belongs to which phone number, and the names the
-- linked phone knows people by. WhatsApp sends these separately from messages (history sync,
-- contact sync, phone-number shares); without them a chat you started to someone's "@lid"
-- became a second contact instead of joining their phone-number chat.
-- Run once in the Supabase SQL editor, after 002_whatsapp.sql. Safe on existing data.

begin;

-- One row per id WhatsApp has shown us for a person — their @lid and/or their phone jid.
-- Kept even for people with no chat yet, so a first message from them already has a name.
create table wa_directory (
  account_id uuid not null references wa_accounts(id) on delete cascade,
  jid text not null,        -- the id as WhatsApp used it: <lid>@lid or <phone>@s.whatsapp.net
  pn_jid text,              -- the phone jid behind it, when known (= jid for phone rows)
  saved_name text,          -- name in the linked phone's address book
  push_name text,           -- name they set on WhatsApp themselves
  primary key (account_id, jid)
);

-- Name from the linked phone's address book, shown before their self-set (push) name.
alter table wa_contacts add column saved_name text;

commit;
