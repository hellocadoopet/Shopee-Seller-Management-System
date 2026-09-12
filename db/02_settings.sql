-- Run this once in the Supabase SQL editor to add the AI settings table.
-- Safe to run on an existing database (won't touch other tables).

create table if not exists app_settings (
  id int primary key default 1,
  llm_provider text not null default 'claude',   -- claude | openai | deepseek
  llm_api_key_enc text,                           -- encrypted API key (AES-256-GCM)
  llm_model text,
  updated_at timestamptz not null default now(),
  constraint app_settings_single_row check (id = 1)
);

insert into app_settings (id, llm_provider) values (1, 'claude')
on conflict (id) do nothing;
