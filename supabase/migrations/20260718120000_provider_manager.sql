-- Provider Manager: durable health, circuit and diagnostics state.
-- Safe to run on a blank database or an existing installation.
alter table public.providers
  add column if not exists priority integer not null default 100,
  add column if not exists timeout_ms integer not null default 45000,
  add column if not exists retries integer not null default 2,
  add column if not exists max_connections integer not null default 4,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists latency_ms integer,
  add column if not exists last_check_at timestamptz,
  add column if not exists error_count integer not null default 0,
  add column if not exists success_count integer not null default 0,
  add column if not exists availability numeric(6,3) not null default 1,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists circuit_state text not null default 'closed',
  add column if not exists circuit_failures integer not null default 0,
  add column if not exists circuit_opened_at timestamptz,
  add column if not exists circuit_next_retry_at timestamptz,
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists capabilities jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.providers drop constraint if exists providers_health_status_check;
  alter table public.providers add constraint providers_health_status_check
    check (health_status in ('healthy','degraded','offline','unknown'));
  alter table public.providers drop constraint if exists providers_circuit_state_check;
  alter table public.providers add constraint providers_circuit_state_check
    check (circuit_state in ('closed','open','half_open'));
  alter table public.providers drop constraint if exists providers_manager_limits_check;
  alter table public.providers add constraint providers_manager_limits_check
    check (priority between 0 and 100000 and timeout_ms between 5000 and 55000 and retries between 0 and 5 and max_connections between 1 and 100);
exception when duplicate_object then null;
end $$;

create index if not exists providers_manager_selection_idx
  on public.providers(user_id, is_enabled, circuit_state, health_status, priority);
create index if not exists providers_manager_health_idx
  on public.providers(health_status, last_check_at);

create table if not exists public.provider_manager_logs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text,
  request_id text not null,
  status_code integer,
  category text not null,
  code text not null,
  message text not null,
  duration_ms integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists provider_manager_logs_owner_time_idx
  on public.provider_manager_logs(user_id, created_at desc);
create index if not exists provider_manager_logs_provider_time_idx
  on public.provider_manager_logs(provider_id, created_at desc);
alter table public.provider_manager_logs enable row level security;
drop policy if exists provider_manager_logs_owner_read on public.provider_manager_logs;
create policy provider_manager_logs_owner_read on public.provider_manager_logs
  for select to authenticated using ((select auth.uid()) = user_id);

-- The API uses the service role after checking ownership. Do not grant direct
-- insert/update access to browser roles; this table must never receive secrets.
revoke all on public.provider_manager_logs from anon, authenticated;
grant select on public.provider_manager_logs to authenticated;
