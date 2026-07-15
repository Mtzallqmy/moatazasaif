-- Secure token-backed integrations managed only by authenticated Vercel
-- Functions. Credential material is encrypted before insert and these rows
-- are never exposed through PostgREST/browser roles.
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

alter table public.external_integrations enable row level security;
revoke all on public.external_integrations from public, anon, authenticated;
grant all on public.external_integrations to service_role;
