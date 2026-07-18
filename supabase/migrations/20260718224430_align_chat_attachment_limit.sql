-- Keep the persisted message contract aligned with the API/UI contract.
-- Payloads contain metadata only; file bytes stay in the private bucket.
alter table public.messages
  drop constraint if exists messages_attachments_metadata_check;

alter table public.messages
  add constraint messages_attachments_metadata_check check (
    jsonb_typeof(attachments) = 'array'
    and jsonb_array_length(attachments) <= 5
    and pg_column_size(attachments) <= 16384
    and not jsonb_path_exists(attachments, '$[*].dataUrl')
    and not jsonb_path_exists(attachments, '$[*].text')
    and not jsonb_path_exists(attachments, '$[*].base64')
    and not jsonb_path_exists(attachments, '$[*].url')
  );

-- Provider calls must finish early enough to return a structured SSE error
-- before the hosting function reaches its hard deadline.
update public.providers
set timeout_ms = least(timeout_ms, 45000)
where timeout_ms > 45000;

alter table public.providers
  alter column timeout_ms set default 35000;

alter table public.providers
  drop constraint if exists providers_manager_limits_check;

alter table public.providers
  add constraint providers_manager_limits_check check (
    priority between 0 and 100000
    and timeout_ms between 5000 and 45000
    and retries between 0 and 5
    and max_connections between 1 and 100
  );
