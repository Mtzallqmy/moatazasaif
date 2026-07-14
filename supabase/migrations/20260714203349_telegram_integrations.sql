-- Telegram Bot integration for Vercel Functions.
-- Secret-bearing tables are intentionally server-only. The service_role is
-- used by authenticated API functions and by the unauthenticated webhook.

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

create index if not exists telegram_integrations_user_idx
  on public.telegram_integrations(user_id, created_at desc);
create index if not exists telegram_integrations_provider_idx
  on public.telegram_integrations(provider_id);
create unique index if not exists telegram_integrations_webhook_hash_uidx
  on public.telegram_integrations(webhook_secret_hash);
create index if not exists telegram_chat_links_integration_idx
  on public.telegram_chat_links(integration_id, linked_at desc);
create index if not exists telegram_link_codes_active_idx
  on public.telegram_link_codes(integration_id, expires_at desc)
  where used_at is null;
create index if not exists telegram_updates_integration_received_idx
  on public.telegram_updates(integration_id, received_at desc);
create index if not exists telegram_messages_context_idx
  on public.telegram_messages(integration_id, telegram_chat_id, created_at desc);

alter table public.telegram_integrations enable row level security;
alter table public.telegram_chat_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.telegram_messages enable row level security;

-- No browser policies are created. Even metadata is returned only through
-- Vercel Functions that authenticate ownership and strip all secret columns.
revoke all on public.telegram_integrations from public, anon, authenticated;
revoke all on public.telegram_chat_links from public, anon, authenticated;
revoke all on public.telegram_link_codes from public, anon, authenticated;
revoke all on public.telegram_updates from public, anon, authenticated;
revoke all on public.telegram_messages from public, anon, authenticated;

grant all on public.telegram_integrations to service_role;
grant all on public.telegram_chat_links to service_role;
grant all on public.telegram_link_codes to service_role;
grant all on public.telegram_updates to service_role;
grant all on public.telegram_messages to service_role;
