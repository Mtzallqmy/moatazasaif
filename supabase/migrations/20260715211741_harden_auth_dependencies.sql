-- Event-trigger functions never need to be callable through the Data API.
-- Removing these grants closes the SECURITY DEFINER RPC path reported by the
-- Supabase security advisor without affecting the event trigger itself.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- Cover foreign keys used by auth/profile and chat operations. Besides query
-- performance, these prevent parent-row changes from taking broad table locks
-- once OAuth signups and chat traffic grow.
create index if not exists chats_provider_id_idx
  on public.chats(provider_id)
  where provider_id is not null;

create index if not exists messages_user_id_idx
  on public.messages(user_id);

create index if not exists profiles_created_by_idx
  on public.profiles(created_by)
  where created_by is not null;

-- Keep the provider-ownership helper out of the exposed public schema. The
-- function still checks auth.uid() and is available only to authenticated RLS
-- evaluation, but it can no longer be reached as /rest/v1/rpc/owns_provider.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

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

drop policy if exists chats_owner_insert on public.chats;
create policy chats_owner_insert on public.chats for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (provider_id is null or (select private.owns_provider(provider_id)))
);

drop policy if exists chats_owner_update on public.chats;
create policy chats_owner_update on public.chats for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (provider_id is null or (select private.owns_provider(provider_id)))
);

drop function if exists public.owns_provider(uuid);
