-- Keep webhook rotations available during Telegram retries and prevent the
-- same bot from being attached to multiple accounts. Telegram supports only
-- one webhook per bot, so a global bot_id uniqueness boundary is required.

alter table public.telegram_integrations
  add column if not exists previous_webhook_secret_hash text
    check (
      previous_webhook_secret_hash is null
      or previous_webhook_secret_hash ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists previous_webhook_secret_expires_at timestamptz;

create unique index if not exists telegram_integrations_bot_id_uidx
  on public.telegram_integrations(bot_id);

create index if not exists telegram_integrations_previous_webhook_hash_idx
  on public.telegram_integrations(previous_webhook_secret_hash)
  where previous_webhook_secret_hash is not null;

