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
