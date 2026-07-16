begin;

create extension if not exists pgcrypto;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  environment text not null default 'live' check (environment in ('live','test')),
  key_prefix text not null,
  key_hash text not null unique,
  key_preview text not null,
  scopes text[] not null default '{}',
  allowed_models text[] not null default '{}',
  allowed_services text[] not null default '{}',
  allowed_ips inet[] not null default '{}',
  rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute between 1 and 10000),
  daily_request_limit integer check (daily_request_limit is null or daily_request_limit > 0),
  monthly_request_limit integer check (monthly_request_limit is null or monthly_request_limit > 0),
  monthly_credit_limit numeric check (monthly_credit_limit is null or monthly_credit_limit >= 0),
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip inet,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  request_id text not null,
  endpoint text not null,
  method text not null,
  service text,
  model text,
  status_code integer not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  latency_ms integer,
  provider_latency_ms integer,
  ip_address inet,
  user_agent text,
  error_code text,
  safe_error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  name text not null,
  url text not null,
  encrypted_secret text not null,
  secret_preview text not null,
  subscribed_events text[] not null default '{}',
  is_active boolean not null default true,
  status text not null default 'active' check (status in ('active','disabled','degraded')),
  failure_count integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id text not null,
  event_type text not null,
  attempt_number integer not null default 1,
  status text not null,
  status_code integer,
  request_body jsonb,
  response_preview text,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid references public.api_keys(id) on delete cascade,
  idempotency_key text not null,
  endpoint text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(api_key_id,idempotency_key,endpoint)
);

create index if not exists api_keys_user_idx on public.api_keys(user_id,created_at desc);
create index if not exists api_keys_workspace_idx on public.api_keys(workspace_id) where workspace_id is not null;
create index if not exists api_keys_expiry_idx on public.api_keys(expires_at) where expires_at is not null;
create index if not exists api_keys_revoked_idx on public.api_keys(revoked_at) where revoked_at is not null;
create index if not exists api_usage_user_created_idx on public.api_usage_logs(user_id,created_at desc);
create index if not exists api_usage_key_created_idx on public.api_usage_logs(api_key_id,created_at desc);
create index if not exists api_usage_request_idx on public.api_usage_logs(request_id);
create index if not exists webhook_owner_idx on public.webhook_endpoints(user_id,created_at desc);
create index if not exists webhook_delivery_event_idx on public.webhook_deliveries(event_id);
create index if not exists webhook_delivery_retry_idx on public.webhook_deliveries(next_retry_at) where next_retry_at is not null;
create index if not exists idempotency_expiry_idx on public.idempotency_keys(expires_at);

alter table public.api_keys enable row level security;
alter table public.api_usage_logs enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.idempotency_keys enable row level security;

revoke all on public.api_keys, public.api_usage_logs, public.webhook_endpoints, public.webhook_deliveries, public.idempotency_keys from anon, authenticated;

drop policy if exists api_keys_owner_select on public.api_keys;
create policy api_keys_owner_select on public.api_keys for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists api_usage_owner_select on public.api_usage_logs;
create policy api_usage_owner_select on public.api_usage_logs for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists webhook_owner_select on public.webhook_endpoints;
create policy webhook_owner_select on public.webhook_endpoints for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists webhook_delivery_owner_select on public.webhook_deliveries;
create policy webhook_delivery_owner_select on public.webhook_deliveries for select to authenticated using (exists (select 1 from public.webhook_endpoints e where e.id = webhook_endpoint_id and e.user_id = (select auth.uid())));

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists api_keys_touch_updated_at on public.api_keys;
create trigger api_keys_touch_updated_at before update on public.api_keys for each row execute function public.touch_updated_at();
drop trigger if exists webhook_endpoints_touch_updated_at on public.webhook_endpoints;
create trigger webhook_endpoints_touch_updated_at before update on public.webhook_endpoints for each row execute function public.touch_updated_at();

commit;