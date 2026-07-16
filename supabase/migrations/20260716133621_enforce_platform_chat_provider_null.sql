-- Platform-managed chats never retain a user-owned provider reference.
update public.chats
set provider_id = null
where credential_mode = 'platform' and provider_id is not null;

alter table public.chats drop constraint if exists chats_platform_provider_null_check;
alter table public.chats add constraint chats_platform_provider_null_check
  check (credential_mode <> 'platform' or provider_id is null);
