-- Moataz AI — production Supabase schema
-- Idempotent: safe to re-run from Supabase SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Remove unsafe artifacts from older project revisions.
drop trigger if exists ensure_last_owner on auth.users;
drop function if exists public.check_last_owner() cascade;

-- =========================================================
-- Profiles and application roles
-- Authorization is read from this table, never from user_metadata.
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text not null default 'مستخدم',
  avatar_url text,
  role text not null default 'user',
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  is_internal_email boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  last_login_at timestamptz,
  preferences jsonb not null default '{"language":"ar","theme":"system","reduceMotion":false,"highContrast":false,"fontScale":"md"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text not null default 'مستخدم';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists is_internal_email boolean not null default false;
alter table public.profiles add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists preferences jsonb not null default '{"language":"ar","theme":"system","reduceMotion":false,"highContrast":false,"fontScale":"md"}'::jsonb;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Normalize legacy values before replacing validation constraints.
update public.profiles set role = 'manager' where role = 'supervisor';
update public.profiles
set role = 'user'
where role is null or role not in ('owner', 'admin', 'manager', 'editor', 'user');

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'manager', 'editor', 'user'));

update public.profiles profile set role = 'user', updated_at = now()
where profile.role = 'owner' and not exists (
  select 1 from auth.users auth_user where auth_user.id = profile.id
    and lower(auth_user.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com')
);
update public.profiles profile set role = 'owner', is_active = true, updated_at = now()
where exists (
  select 1 from auth.users auth_user where auth_user.id = profile.id
    and lower(auth_user.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com')
);

alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles add constraint profiles_username_check
  check (username is null or username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$');

update public.profiles
set preferences = '{"language":"ar","theme":"system","reduceMotion":false,"highContrast":false,"fontScale":"md"}'::jsonb
where jsonb_typeof(preferences) is distinct from 'object'
   or preferences ->> 'language' not in ('ar', 'en')
   or preferences ->> 'theme' not in ('system', 'light', 'dark', 'eye')
   or jsonb_typeof(preferences -> 'reduceMotion') is distinct from 'boolean'
   or jsonb_typeof(preferences -> 'highContrast') is distinct from 'boolean'
   or preferences ->> 'fontScale' not in ('sm', 'md', 'lg');

alter table public.profiles drop constraint if exists profiles_preferences_check;
alter table public.profiles add constraint profiles_preferences_check check (
  jsonb_typeof(preferences) = 'object'
  and preferences ->> 'language' in ('ar', 'en')
  and preferences ->> 'theme' in ('system', 'light', 'dark', 'eye')
  and jsonb_typeof(preferences -> 'reduceMotion') = 'boolean'
  and jsonb_typeof(preferences -> 'highContrast') = 'boolean'
  and preferences ->> 'fontScale' in ('sm', 'md', 'lg')
);

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username)) where username is not null;
create index if not exists profiles_role_active_idx on public.profiles(role, is_active);

-- Create a default profile for every new Supabase Auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    role,
    is_active,
    must_change_password,
    is_internal_email
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'مستخدم'), '@', 1)),
    case
      when lower(new.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com') then 'owner'
      when new.raw_app_meta_data ->> 'app_role' in ('admin', 'manager', 'editor', 'user')
        then new.raw_app_meta_data ->> 'app_role'
      else 'user'
    end,
    true,
    false,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.enforce_profile_owner_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'owner' and not exists (
    select 1 from auth.users auth_user
    where auth_user.id = new.id
      and lower(auth_user.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com')
  ) then
    raise exception 'owner role is restricted' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_profile_owner_email() from public, anon, authenticated;
drop trigger if exists enforce_profile_owner_email on public.profiles;
create trigger enforce_profile_owner_email before insert or update of role on public.profiles
for each row execute function public.enforce_profile_owner_email();

-- Backfill profiles for existing Auth users without changing their passwords.
insert into public.profiles (id, display_name, role, is_active)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(u.email, 'مستخدم'), '@', 1)),
  case
    when lower(u.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com') then 'owner'
    when u.raw_app_meta_data ->> 'app_role' in ('admin', 'manager', 'editor', 'user')
      then u.raw_app_meta_data ->> 'app_role'
    else 'user'
  end,
  true
from auth.users u
on conflict (id) do nothing;

-- =========================================================
-- Provider credentials and diagnostics
-- =========================================================
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (char_length(type) between 1 and 40 and type ~ '^[a-z0-9-]+$'),
  protocol text not null default 'openai-compatible' check (protocol in ('openai-compatible','gemini','anthropic')),
  base_url text,
  model text,
  encrypted_key jsonb not null,
  is_enabled boolean not null default true,
  status text not null default 'untested' check (status in ('connected','error','untested')),
  error_message text,
  models jsonb not null default '[]'::jsonb,
  detected_protocol text,
  diagnostic jsonb,
  last_latency_ms integer,
  last_http_status integer,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.providers add column if not exists base_url text;
alter table public.providers add column if not exists model text;
alter table public.providers add column if not exists protocol text;
alter table public.providers add column if not exists encrypted_key jsonb;
alter table public.providers add column if not exists is_enabled boolean not null default true;
alter table public.providers add column if not exists status text not null default 'untested';
alter table public.providers add column if not exists error_message text;
alter table public.providers add column if not exists models jsonb not null default '[]'::jsonb;
alter table public.providers add column if not exists detected_protocol text;
alter table public.providers add column if not exists diagnostic jsonb;
alter table public.providers add column if not exists last_latency_ms integer;
alter table public.providers add column if not exists last_http_status integer;
alter table public.providers add column if not exists last_tested_at timestamptz;
alter table public.providers add column if not exists updated_at timestamptz not null default now();

update public.providers
set protocol = case
  when type = 'gemini' or coalesce(base_url, '') like '%generativelanguage.googleapis.com%' then 'gemini'
  when type = 'anthropic' or coalesce(base_url, '') like '%anthropic.com%' then 'anthropic'
  else 'openai-compatible'
end
where protocol is null
   or protocol not in ('openai-compatible','gemini','anthropic')
   or (type = 'gemini' and protocol <> 'gemini')
   or (type = 'anthropic' and protocol <> 'anthropic');

alter table public.providers alter column protocol set default 'openai-compatible';
alter table public.providers alter column protocol set not null;
alter table public.providers drop constraint if exists providers_type_check;
alter table public.providers drop constraint if exists providers_type_format_check;
alter table public.providers add constraint providers_type_format_check
  check (char_length(type) between 1 and 40 and type ~ '^[a-z0-9-]+$');
alter table public.providers drop constraint if exists providers_protocol_check;
alter table public.providers add constraint providers_protocol_check
  check (protocol in ('openai-compatible','gemini','anthropic'));

create index if not exists providers_user_id_idx on public.providers(user_id);

-- Field-level protection: browser clients never receive encrypted_key.
-- This helper is kept outside the exposed public schema and is used only by
-- chat RLS to verify provider ownership.
drop function if exists public.owns_provider(uuid) cascade;
create or replace function private.owns_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.providers p
    where p.id = p_provider_id
      and p.user_id = (select auth.uid())
  );
$$;

revoke all on function private.owns_provider(uuid) from public, anon;
grant execute on function private.owns_provider(uuid) to authenticated;

-- =========================================================
-- Chats and messages
-- =========================================================
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'محادثة جديدة',
  provider_id uuid references public.providers(id) on delete set null,
  model text not null default '',
  mode text not null default 'chat' check (mode in ('chat','agent')),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null,
  model text,
  tokens integer,
  created_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx on public.chats(user_id, updated_at desc);
create index if not exists chats_provider_id_idx on public.chats(provider_id) where provider_id is not null;
create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at);
create index if not exists messages_user_id_idx on public.messages(user_id);
create index if not exists profiles_created_by_idx on public.profiles(created_by) where created_by is not null;

-- =========================================================
-- GitHub and WhatsApp integrations (server-only secrets)
-- =========================================================
create table if not exists public.external_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('github', 'whatsapp')),
  name text not null check (char_length(name) between 1 and 80),
  encrypted_credentials jsonb not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  external_account_id text not null check (char_length(external_account_id) between 1 and 200),
  external_account_name text check (external_account_name is null or char_length(external_account_name) between 1 and 300),
  is_enabled boolean not null default true,
  status text not null default 'connected' check (status in ('connected', 'error', 'disabled')),
  last_checked_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, external_account_id)
);

create index if not exists external_integrations_user_created_idx
  on public.external_integrations(user_id, created_at desc);

-- =========================================================
-- Telegram Bot integrations (server-only secrets)
-- =========================================================
create table if not exists public.telegram_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  bot_id text not null check (char_length(bot_id) between 1 and 32),
  bot_username text,
  bot_first_name text,
  encrypted_bot_token jsonb not null,
  webhook_secret_hash text not null check (webhook_secret_hash ~ '^[a-f0-9]{64}$'),
  provider_id uuid not null references public.providers(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 300),
  is_enabled boolean not null default true,
  status text not null default 'registering'
    check (status in ('registering', 'connected', 'error', 'disabled')),
  webhook_url text,
  pending_update_count integer not null default 0 check (pending_update_count >= 0),
  last_error_message text,
  last_webhook_checked_at timestamptz,
  last_update_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bot_id)
);

create table if not exists public.telegram_chat_links (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.telegram_integrations(id) on delete cascade,
  telegram_chat_id text not null check (char_length(telegram_chat_id) between 1 and 32),
  telegram_user_id text,
  chat_type text,
  username text,
  first_name text,
  last_name text,
  title text,
  is_allowed boolean not null default true,
  linked_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (integration_id, telegram_chat_id)
);

create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.telegram_integrations(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_updates (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.telegram_integrations(id) on delete cascade,
  update_id bigint not null,
  telegram_chat_id text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (integration_id, update_id)
);

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.telegram_integrations(id) on delete cascade,
  telegram_chat_id text not null check (char_length(telegram_chat_id) between 1 and 32),
  telegram_message_id bigint,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null check (char_length(content) between 1 and 100000),
  model text,
  tokens integer check (tokens is null or tokens >= 0),
  created_at timestamptz not null default now()
);

create index if not exists telegram_integrations_user_idx on public.telegram_integrations(user_id, created_at desc);
create index if not exists telegram_integrations_provider_idx on public.telegram_integrations(provider_id);
create unique index if not exists telegram_integrations_webhook_hash_uidx on public.telegram_integrations(webhook_secret_hash);
create index if not exists telegram_chat_links_integration_idx on public.telegram_chat_links(integration_id, linked_at desc);
create index if not exists telegram_link_codes_active_idx on public.telegram_link_codes(integration_id, expires_at desc) where used_at is null;
create index if not exists telegram_updates_integration_received_idx on public.telegram_updates(integration_id, received_at desc);
create index if not exists telegram_messages_context_idx on public.telegram_messages(integration_id, telegram_chat_id, created_at desc);

-- =========================================================
-- Audit trail (server-only)
-- =========================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs add column if not exists actor_id uuid references auth.users(id) on delete set null;
alter table public.audit_logs add column if not exists target_user_id uuid references auth.users(id) on delete set null;
alter table public.audit_logs add column if not exists details jsonb not null default '{}'::jsonb;
create index if not exists audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_target_created_idx on public.audit_logs(target_user_id, created_at desc);

-- Remove a legacy browser-visible audit policy if an older schema created it.
drop policy if exists audit_logs_owner_select on public.audit_logs;

-- =========================================================
-- Atomic API rate limits (server-only)
-- =========================================================
create table if not exists public.api_rate_limits (
  key_hash text not null,
  action text not null,
  request_count integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (key_hash, action),
  constraint api_rate_limits_key_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint api_rate_limits_action_check check (char_length(action) between 1 and 80)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits(updated_at);

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_window_started_at timestamptz;
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate limit key';
  end if;
  if p_action is null or char_length(p_action) not between 1 and 80 then
    raise exception 'invalid rate limit action';
  end if;
  if p_limit not between 1 and 100000 or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit configuration';
  end if;

  insert into public.api_rate_limits as limits (
    key_hash, action, request_count, window_started_at, updated_at
  ) values (
    p_key_hash, p_action, 1, v_now, v_now
  )
  on conflict (key_hash, action) do update
  set
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1
      else limits.request_count + 1
    end,
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now
      else limits.window_started_at
    end,
    updated_at = v_now
  returning request_count, window_started_at
  into v_count, v_window_started_at;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window_started_at + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;

-- =========================================================
-- Row Level Security
-- =========================================================
alter table public.profiles enable row level security;
alter table public.providers enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.external_integrations enable row level security;
alter table public.telegram_integrations enable row level security;
alter table public.telegram_chat_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.telegram_messages enable row level security;
alter table public.audit_logs enable row level security;
alter table public.api_rate_limits enable row level security;

-- Profiles: browser clients can only read their own profile.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

-- Providers: strictly isolated per user.
drop policy if exists providers_owner_select on public.providers;
drop policy if exists providers_owner_insert on public.providers;
drop policy if exists providers_owner_update on public.providers;
drop policy if exists providers_owner_delete on public.providers;
create policy providers_owner_select on public.providers for select to authenticated using ((select auth.uid()) = user_id);
create policy providers_owner_insert on public.providers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy providers_owner_update on public.providers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy providers_owner_delete on public.providers for delete to authenticated using ((select auth.uid()) = user_id);

-- Chats and messages: ownership plus provider ownership.
drop policy if exists chats_owner_select on public.chats;
drop policy if exists chats_owner_insert on public.chats;
drop policy if exists chats_owner_update on public.chats;
drop policy if exists chats_owner_delete on public.chats;
create policy chats_owner_select on public.chats for select to authenticated using ((select auth.uid()) = user_id);
create policy chats_owner_insert on public.chats for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (provider_id is null or (select private.owns_provider(provider_id)))
);
create policy chats_owner_update on public.chats for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (provider_id is null or (select private.owns_provider(provider_id)))
);
create policy chats_owner_delete on public.chats for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists messages_owner_select on public.messages;
drop policy if exists messages_owner_insert on public.messages;
drop policy if exists messages_owner_delete on public.messages;
create policy messages_owner_select on public.messages for select to authenticated
using ((select auth.uid()) = user_id and exists (
  select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid())
));
create policy messages_owner_insert on public.messages for insert to authenticated
with check ((select auth.uid()) = user_id and exists (
  select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid())
));
create policy messages_owner_delete on public.messages for delete to authenticated
using ((select auth.uid()) = user_id and exists (
  select 1 from public.chats c where c.id = chat_id and c.user_id = (select auth.uid())
));

-- No browser policy is created for audit_logs. It is accessed through server-side admin APIs only.

-- Explicit grants for exposed Data API tables.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.chats, public.messages to authenticated;
revoke all on public.providers from authenticated;
revoke all on public.profiles, public.providers, public.chats, public.messages, public.audit_logs from anon;
revoke all on public.audit_logs from authenticated;
revoke all on public.api_rate_limits from public, anon, authenticated;
revoke all on public.external_integrations from public, anon, authenticated;
revoke all on public.telegram_integrations, public.telegram_chat_links, public.telegram_link_codes, public.telegram_updates, public.telegram_messages from public, anon, authenticated;
grant all on public.external_integrations to service_role;
grant all on public.telegram_integrations, public.telegram_chat_links, public.telegram_link_codes, public.telegram_updates, public.telegram_messages to service_role;

-- =========================================================
-- Platform-managed provider, daily quotas, and attachment metadata
-- =========================================================
-- Platform-managed provider and daily per-user quotas.
-- All credentials and quota mutations remain service-role only.

alter table public.providers
  add column if not exists is_platform_shared boolean not null default false,
  add column if not exists is_platform_default boolean not null default false,
  add column if not exists platform_daily_request_limit integer not null default 50,
  add column if not exists platform_daily_token_limit bigint not null default 100000;

update public.providers
set is_platform_default = false
where is_platform_default and not is_platform_shared;

alter table public.providers drop constraint if exists providers_platform_flags_check;
alter table public.providers add constraint providers_platform_flags_check
  check (not is_platform_default or is_platform_shared);

alter table public.providers drop constraint if exists providers_platform_request_limit_check;
alter table public.providers add constraint providers_platform_request_limit_check
  check (platform_daily_request_limit between 1 and 100000);

alter table public.providers drop constraint if exists providers_platform_token_limit_check;
alter table public.providers add constraint providers_platform_token_limit_check
  check (platform_daily_token_limit between 1000 and 1000000000);

create unique index if not exists providers_single_platform_default_uidx
  on public.providers ((1)) where is_platform_default;

alter table public.chats add column if not exists credential_mode text not null default 'saved';
update public.chats set credential_mode = 'saved' where credential_mode not in ('saved', 'platform');
alter table public.chats drop constraint if exists chats_credential_mode_check;
alter table public.chats add constraint chats_credential_mode_check
  check (credential_mode in ('saved', 'platform'));
alter table public.chats drop constraint if exists chats_platform_provider_null_check;
alter table public.chats add constraint chats_platform_provider_null_check
  check (credential_mode <> 'platform' or provider_id is null);

alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;
update public.messages set attachments = '[]'::jsonb where jsonb_typeof(attachments) is distinct from 'array';
alter table public.messages drop constraint if exists messages_attachments_metadata_check;
alter table public.messages add constraint messages_attachments_metadata_check check (
  jsonb_typeof(attachments) = 'array'
  and jsonb_array_length(attachments) <= 3
  and pg_column_size(attachments) <= 16384
  and not jsonb_path_exists(attachments, '$[*].dataUrl')
  and not jsonb_path_exists(attachments, '$[*].text')
  and not jsonb_path_exists(attachments, '$[*].base64')
  and not jsonb_path_exists(attachments, '$[*].url')
);

create table if not exists public.platform_provider_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  token_count bigint not null default 0 check (token_count >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, provider_id, usage_date)
);

create table if not exists public.platform_provider_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  usage_date date not null,
  reserved_tokens bigint not null check (reserved_tokens between 1 and 5000000),
  actual_tokens bigint check (actual_tokens is null or actual_tokens between 0 and 100000000),
  charged_tokens bigint check (charged_tokens is null or charged_tokens between 0 and 100000000),
  status text not null default 'reserved' check (status in ('reserved', 'completed', 'failed', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz
);

create index if not exists platform_provider_usage_date_idx
  on public.platform_provider_usage(usage_date, updated_at);
create index if not exists platform_provider_reservations_active_idx
  on public.platform_provider_reservations(user_id, provider_id, usage_date, created_at)
  where status = 'reserved';
create index if not exists platform_provider_usage_provider_idx
  on public.platform_provider_usage(provider_id);
create index if not exists platform_provider_reservations_provider_idx
  on public.platform_provider_reservations(provider_id);

alter table public.platform_provider_usage enable row level security;
alter table public.platform_provider_reservations enable row level security;
revoke all on public.platform_provider_usage, public.platform_provider_reservations from public, anon, authenticated;
grant all on public.platform_provider_usage, public.platform_provider_reservations to service_role;

create or replace function public.configure_platform_provider(
  p_actor_id uuid,
  p_provider_id uuid,
  p_is_shared boolean,
  p_is_default boolean,
  p_daily_request_limit integer,
  p_daily_token_limit bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers%rowtype;
  v_shared boolean;
  v_default boolean;
  v_request_limit integer;
  v_token_limit bigint;
begin
  perform pg_advisory_xact_lock(478235901);

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_actor_id
      and profile.role = 'owner'
      and profile.is_active
  ) then
    raise exception 'owner role required' using errcode = '42501';
  end if;

  select provider.* into v_provider
  from public.providers provider
  where provider.id = p_provider_id
    and provider.user_id = p_actor_id
  for update;

  if not found then
    raise exception 'owned provider not found' using errcode = 'P0002';
  end if;

  v_shared := coalesce(p_is_shared, v_provider.is_platform_shared);
  v_default := coalesce(p_is_default, v_provider.is_platform_default);
  v_request_limit := coalesce(p_daily_request_limit, v_provider.platform_daily_request_limit);
  v_token_limit := coalesce(p_daily_token_limit, v_provider.platform_daily_token_limit);

  if v_request_limit not between 1 and 100000 or v_token_limit not between 1000 and 1000000000 then
    raise exception 'invalid platform quota' using errcode = '22023';
  end if;

  if not v_shared then
    v_default := false;
  end if;

  if v_default then
    if not v_provider.is_enabled or v_provider.status <> 'connected' or nullif(v_provider.model, '') is null then
      raise exception 'default platform provider must be enabled, connected, and have a model' using errcode = '23514';
    end if;
    v_shared := true;
    update public.providers set is_platform_default = false
    where is_platform_default and id <> p_provider_id;
  end if;

  update public.providers
  set is_platform_shared = v_shared,
      is_platform_default = v_default,
      platform_daily_request_limit = v_request_limit,
      platform_daily_token_limit = v_token_limit,
      updated_at = clock_timestamp()
  where id = p_provider_id;

  return jsonb_build_object(
    'providerId', p_provider_id,
    'isShared', v_shared,
    'isDefault', v_default,
    'dailyRequestLimit', v_request_limit,
    'dailyTokenLimit', v_token_limit
  );
end;
$$;

create or replace function public.reserve_platform_provider_usage(
  p_user_id uuid,
  p_estimated_tokens bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'utc')::date;
  v_provider_id uuid;
  v_request_limit integer;
  v_token_limit bigint;
  v_request_count integer;
  v_token_count bigint;
  v_reserved_tokens bigint;
  v_expired_tokens bigint := 0;
  v_reservation_id uuid := gen_random_uuid();
  v_rows integer;
  v_reset_at timestamptz;
begin
  if p_user_id is null or p_estimated_tokens not between 1 and 5000000 then
    raise exception 'invalid platform reservation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.is_active
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'user_unavailable');
  end if;

  select provider.id, provider.platform_daily_request_limit, provider.platform_daily_token_limit
  into v_provider_id, v_request_limit, v_token_limit
  from public.providers provider
  join public.profiles owner_profile on owner_profile.id = provider.user_id
  where provider.is_platform_default
    and provider.is_platform_shared
    and provider.is_enabled
    and provider.status = 'connected'
    and nullif(provider.model, '') is not null
    and owner_profile.role = 'owner'
    and owner_profile.is_active
  limit 1
  for share of provider;

  if v_provider_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'provider_unavailable');
  end if;

  with expired as (
    update public.platform_provider_reservations reservation
    set status = 'expired', finalized_at = v_now, actual_tokens = 0, charged_tokens = 0
    where reservation.user_id = p_user_id
      and reservation.provider_id = v_provider_id
      and reservation.usage_date = v_today
      and reservation.status = 'reserved'
      and reservation.created_at < v_now - interval '5 minutes'
    returning reservation.reserved_tokens
  )
  select coalesce(sum(expired.reserved_tokens), 0) into v_expired_tokens from expired;

  if v_expired_tokens > 0 then
    update public.platform_provider_usage usage
    set reserved_tokens = greatest(usage.reserved_tokens - v_expired_tokens, 0),
        updated_at = v_now
    where usage.user_id = p_user_id
      and usage.provider_id = v_provider_id
      and usage.usage_date = v_today;
  end if;

  insert into public.platform_provider_usage(user_id, provider_id, usage_date)
  values (p_user_id, v_provider_id, v_today)
  on conflict (user_id, provider_id, usage_date) do nothing;

  update public.platform_provider_usage usage
  set request_count = usage.request_count + 1,
      reserved_tokens = usage.reserved_tokens + p_estimated_tokens,
      updated_at = v_now
  where usage.user_id = p_user_id
    and usage.provider_id = v_provider_id
    and usage.usage_date = v_today
    and usage.request_count < v_request_limit
    and usage.token_count + usage.reserved_tokens + p_estimated_tokens <= v_token_limit;

  get diagnostics v_rows = row_count;

  select usage.request_count, usage.token_count, usage.reserved_tokens
  into v_request_count, v_token_count, v_reserved_tokens
  from public.platform_provider_usage usage
  where usage.user_id = p_user_id
    and usage.provider_id = v_provider_id
    and usage.usage_date = v_today;

  v_reset_at := (v_today + 1)::timestamp at time zone 'UTC';

  if v_rows = 0 then
    return jsonb_build_object(
      'allowed', false,
      'reason', case when v_request_count >= v_request_limit then 'request_limit' else 'token_limit' end,
      'providerId', v_provider_id,
      'requestsUsed', v_request_count,
      'requestsLimit', v_request_limit,
      'tokensUsed', v_token_count,
      'tokensReserved', v_reserved_tokens,
      'tokensLimit', v_token_limit,
      'resetAt', v_reset_at
    );
  end if;

  insert into public.platform_provider_reservations(
    id, user_id, provider_id, usage_date, reserved_tokens
  ) values (
    v_reservation_id, p_user_id, v_provider_id, v_today, p_estimated_tokens
  );

  return jsonb_build_object(
    'allowed', true,
    'reservationId', v_reservation_id,
    'providerId', v_provider_id,
    'reservedTokens', p_estimated_tokens,
    'requestsUsed', v_request_count,
    'requestsLimit', v_request_limit,
    'tokensUsed', v_token_count,
    'tokensReserved', v_reserved_tokens,
    'tokensLimit', v_token_limit,
    'resetAt', v_reset_at
  );
end;
$$;

create or replace function public.finalize_platform_provider_usage(
  p_reservation_id uuid,
  p_actual_tokens bigint,
  p_charge_reserved_on_zero boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.platform_provider_reservations%rowtype;
  v_charge bigint;
  v_rows integer;
begin
  if p_reservation_id is null or p_actual_tokens not between 0 and 100000000 then
    raise exception 'invalid platform finalization' using errcode = '22023';
  end if;

  select reservation.* into v_reservation
  from public.platform_provider_reservations reservation
  where reservation.id = p_reservation_id
  for update;

  if not found then
    return jsonb_build_object('finalized', false, 'reason', 'reservation_not_found');
  end if;

  if v_reservation.status <> 'reserved' then
    return jsonb_build_object(
      'finalized', true,
      'duplicate', true,
      'chargedTokens', coalesce(v_reservation.charged_tokens, 0)
    );
  end if;

  v_charge := case
    when p_actual_tokens > 0 then p_actual_tokens
    when p_charge_reserved_on_zero then v_reservation.reserved_tokens
    else 0
  end;

  update public.platform_provider_usage usage
  set reserved_tokens = greatest(usage.reserved_tokens - v_reservation.reserved_tokens, 0),
      token_count = usage.token_count + v_charge,
      updated_at = clock_timestamp()
  where usage.user_id = v_reservation.user_id
    and usage.provider_id = v_reservation.provider_id
    and usage.usage_date = v_reservation.usage_date;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'platform usage row missing' using errcode = 'P0002';
  end if;

  update public.platform_provider_reservations
  set actual_tokens = p_actual_tokens,
      charged_tokens = v_charge,
      status = case when p_charge_reserved_on_zero or p_actual_tokens > 0 then 'completed' else 'failed' end,
      finalized_at = clock_timestamp()
  where id = p_reservation_id;

  return jsonb_build_object('finalized', true, 'chargedTokens', v_charge);
end;
$$;

revoke all on function public.configure_platform_provider(uuid, uuid, boolean, boolean, integer, bigint) from public, anon, authenticated;
revoke all on function public.reserve_platform_provider_usage(uuid, bigint) from public, anon, authenticated;
revoke all on function public.finalize_platform_provider_usage(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.configure_platform_provider(uuid, uuid, boolean, boolean, integer, bigint) to service_role;
grant execute on function public.reserve_platform_provider_usage(uuid, bigint) to service_role;
grant execute on function public.finalize_platform_provider_usage(uuid, bigint, boolean) to service_role;

-- =========================================================
-- Headless content: sections, bilingual articles and announcements
-- =========================================================
create table if not exists public.content_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  name_ar text not null check (char_length(name_ar) between 1 and 120),
  name_en text check (name_en is null or char_length(name_en) between 1 and 120),
  description_ar text,
  description_en text,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  is_visible boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references public.content_sections(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  title_ar text not null check (char_length(title_ar) between 1 and 200),
  title_en text check (title_en is null or char_length(title_en) between 1 and 200),
  excerpt_ar text check (excerpt_ar is null or char_length(excerpt_ar) <= 500),
  excerpt_en text check (excerpt_en is null or char_length(excerpt_en) <= 500),
  content_ar text not null check (char_length(content_ar) between 1 and 100000),
  content_en text check (content_en is null or char_length(content_en) <= 100000),
  cover_url text check (cover_url is null or char_length(cover_url) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  author_id uuid references auth.users(id) on delete set null,
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  text_ar text not null check (char_length(text_ar) between 1 and 300),
  text_en text check (text_en is null or char_length(text_en) between 1 and 300),
  href text check (href is null or char_length(href) <= 1000),
  placement text not null default 'top' check (placement in ('top', 'dashboard')),
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists content_sections_visible_order_idx on public.content_sections(is_visible, sort_order);
create index if not exists content_sections_created_by_idx on public.content_sections(created_by) where created_by is not null;
create index if not exists articles_publication_idx on public.articles(status, published_at desc);
create index if not exists articles_section_publication_idx on public.articles(section_id, status, published_at desc);
create index if not exists articles_author_id_idx on public.articles(author_id) where author_id is not null;
create index if not exists announcements_active_placement_idx on public.announcements(is_active, placement, sort_order);
create index if not exists announcements_created_by_idx on public.announcements(created_by) where created_by is not null;
alter table public.content_sections enable row level security;
alter table public.articles enable row level security;
alter table public.announcements enable row level security;
drop policy if exists content_sections_public_read on public.content_sections;
create policy content_sections_public_read on public.content_sections for select to anon, authenticated using (is_visible);
drop policy if exists articles_public_read on public.articles;
create policy articles_public_read on public.articles for select to anon, authenticated using (status = 'published' and published_at is not null and published_at <= now());
drop policy if exists announcements_public_read on public.announcements;
create policy announcements_public_read on public.announcements for select to anon, authenticated using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
grant select on public.content_sections, public.articles, public.announcements to anon, authenticated;
revoke insert, update, delete on public.content_sections, public.articles, public.announcements from public, anon, authenticated;
grant all on public.content_sections, public.articles, public.announcements to service_role;
