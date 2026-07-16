-- Account-scoped UI preferences. No policy change is required: profiles are
-- already readable only by the owning authenticated user and mutated by API.
alter table public.profiles
  add column if not exists preferences jsonb not null default
  '{"language":"ar","theme":"system","reduceMotion":false,"highContrast":false,"fontScale":"md"}'::jsonb;

update public.profiles
set preferences = '{"language":"ar","theme":"system","reduceMotion":false,"highContrast":false,"fontScale":"md"}'::jsonb
where jsonb_typeof(preferences) is distinct from 'object'
   or preferences ->> 'language' not in ('ar', 'en')
   or preferences ->> 'theme' not in ('system', 'light', 'dark', 'eye')
   or jsonb_typeof(preferences -> 'reduceMotion') is distinct from 'boolean'
   or jsonb_typeof(preferences -> 'highContrast') is distinct from 'boolean'
   or preferences ->> 'fontScale' not in ('sm', 'md', 'lg');

alter table public.profiles drop constraint if exists profiles_preferences_check;
alter table public.profiles add constraint profiles_preferences_check check (
  jsonb_typeof(preferences) = 'object'
  and preferences ->> 'language' in ('ar', 'en')
  and preferences ->> 'theme' in ('system', 'light', 'dark', 'eye')
  and jsonb_typeof(preferences -> 'reduceMotion') = 'boolean'
  and jsonb_typeof(preferences -> 'highContrast') = 'boolean'
  and preferences ->> 'fontScale' in ('sm', 'md', 'lg')
);

comment on column public.profiles.preferences is
  'Validated, non-sensitive display preferences shared across the user devices.';
