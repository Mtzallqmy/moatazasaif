-- Central, server-managed site identity and navigation. These tables are not
-- exposed directly to browser roles; sanitized values are served by the API.
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  site_name_ar text not null default 'معتز AI' check (char_length(site_name_ar) between 2 and 80),
  site_name_en text not null default 'Moataz AI' check (char_length(site_name_en) between 2 and 80),
  tagline_ar text not null default 'مساحة ذكية للدردشة والمحتوى والتكاملات' check (char_length(tagline_ar) between 2 and 180),
  tagline_en text not null default 'An intelligent workspace for chat, content, and integrations' check (char_length(tagline_en) between 2 and 180),
  footer_text_ar text not null default 'جميع الحقوق محفوظة لدى معتز العلقمي.' check (char_length(footer_text_ar) between 2 and 180),
  footer_text_en text not null default 'All rights reserved to Moataz Alalqami.' check (char_length(footer_text_en) between 2 and 180),
  primary_color text not null default '#526d82' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null default '#6b8f8a' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_style text not null default 'modern' check (font_style in ('modern', 'humanist', 'editorial')),
  allow_registration boolean not null default true,
  blog_enabled boolean not null default true,
  public_status_enabled boolean not null default false,
  maintenance_mode boolean not null default false,
  maintenance_message_ar text check (maintenance_message_ar is null or char_length(maintenance_message_ar) <= 240),
  maintenance_message_en text check (maintenance_message_en is null or char_length(maintenance_message_en) <= 240),
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object' and pg_column_size(seo) <= 8192),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_navigation (
  id uuid primary key default gen_random_uuid(),
  location text not null check (location in ('header', 'footer')),
  label_ar text not null check (char_length(label_ar) between 1 and 80),
  label_en text not null check (char_length(label_en) between 1 and 80),
  href text not null check (
    char_length(href) between 1 and 500
    and (href ~ '^/[A-Za-z0-9/_?&=.#%~-]*$' or href ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[A-Za-z0-9/_?&=.#%~-]*)?$')
  ),
  is_external boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id)
values (1)
on conflict (id) do nothing;

create index if not exists site_navigation_location_order_idx
  on public.site_navigation(location, is_active, sort_order);
create index if not exists site_settings_updated_by_idx
  on public.site_settings(updated_by) where updated_by is not null;
create index if not exists site_navigation_created_by_idx
  on public.site_navigation(created_by) where created_by is not null;

alter table public.site_settings enable row level security;
alter table public.site_navigation enable row level security;

revoke all on public.site_settings, public.site_navigation from public, anon, authenticated;
grant all on public.site_settings, public.site_navigation to service_role;

comment on table public.site_settings is 'Singleton public brand configuration, writable only through the role-checked server API.';
comment on table public.site_navigation is 'Public navigation entries managed through the role-checked server API.';
