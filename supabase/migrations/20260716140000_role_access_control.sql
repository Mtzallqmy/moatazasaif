-- Explicit RBAC. New OAuth/password accounts remain users; privileged roles
-- are assigned deliberately. Ownership is restricted to the verified emails.
drop trigger if exists enforce_profile_owner_email on public.profiles;

alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
set role = case
  when role = 'supervisor' then 'manager'
  when role in ('owner', 'admin', 'manager', 'editor', 'user') then role
  else 'user'
end;

update public.profiles profile
set role = 'user', updated_at = now()
where profile.role = 'owner'
  and not exists (
    select 1 from auth.users auth_user
    where auth_user.id = profile.id
      and lower(auth_user.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com')
  );

update public.profiles profile
set role = 'owner', is_active = true, updated_at = now()
where exists (
  select 1 from auth.users auth_user
  where auth_user.id = profile.id
    and lower(auth_user.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com')
);

alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'manager', 'editor', 'user'));

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

create trigger enforce_profile_owner_email
before insert or update of role on public.profiles
for each row execute function public.enforce_profile_owner_email();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, display_name, role, is_active, must_change_password, is_internal_email
  ) values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, 'مستخدم'), '@', 1)),
    case
      when lower(new.email) in ('mtzallqmy@gmail.com', 'moataz77549@gmail.com') then 'owner'
      when new.raw_app_meta_data ->> 'app_role' in ('admin', 'manager', 'editor', 'user')
        then new.raw_app_meta_data ->> 'app_role'
      else 'user'
    end,
    true, false, false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
