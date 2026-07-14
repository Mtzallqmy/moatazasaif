-- BYOK provider contract migration.
-- Safe to run more than once: every constraint/index operation is idempotent.
-- Run this after the original schema (or use schema.sql for a new project).

alter table if exists public.providers
  add column if not exists protocol text;

-- Existing rows may predate the protocol column. Infer only from the stored
-- provider metadata; unknown/custom rows remain OpenAI-compatible by default.
update public.providers
set protocol = case
  when type = 'gemini' or coalesce(base_url, '') ilike '%generativelanguage.googleapis.com%' then 'gemini'
  when type = 'anthropic' or coalesce(base_url, '') ilike '%anthropic.com%' then 'anthropic'
  else 'openai-compatible'
end
where protocol is null
   or protocol not in ('openai-compatible', 'gemini', 'anthropic')
   or (type = 'gemini' and protocol <> 'gemini')
   or (type = 'anthropic' and protocol <> 'anthropic');

alter table if exists public.providers
  alter column protocol set default 'openai-compatible';
alter table if exists public.providers
  alter column protocol set not null;

-- The old schema used an enum-like allow-list that omitted dahl and custom.
-- Keep provider types constrained to safe registry-shaped identifiers instead.
alter table if exists public.providers drop constraint if exists providers_type_check;
alter table if exists public.providers drop constraint if exists providers_type_format_check;
alter table if exists public.providers
  add constraint providers_type_format_check
  check (char_length(type) between 1 and 40 and type ~ '^[a-z0-9-]+$');

alter table if exists public.providers drop constraint if exists providers_protocol_check;
alter table if exists public.providers
  add constraint providers_protocol_check
  check (protocol in ('openai-compatible', 'gemini', 'anthropic'));

create index if not exists providers_user_id_idx on public.providers(user_id);
