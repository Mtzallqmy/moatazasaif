-- Headless content foundation for the web clients and future mobile clients.
create table if not exists public.content_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  name_ar text not null check (char_length(name_ar) between 1 and 120),
  name_en text check (name_en is null or char_length(name_en) between 1 and 120),
  description_ar text,
  description_en text,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  is_visible boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references public.content_sections(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  title_ar text not null check (char_length(title_ar) between 1 and 200),
  title_en text check (title_en is null or char_length(title_en) between 1 and 200),
  excerpt_ar text check (excerpt_ar is null or char_length(excerpt_ar) <= 500),
  excerpt_en text check (excerpt_en is null or char_length(excerpt_en) <= 500),
  content_ar text not null check (char_length(content_ar) between 1 and 100000),
  content_en text check (content_en is null or char_length(content_en) <= 100000),
  cover_url text check (cover_url is null or char_length(cover_url) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  author_id uuid references auth.users(id) on delete set null,
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  text_ar text not null check (char_length(text_ar) between 1 and 300),
  text_en text check (text_en is null or char_length(text_en) between 1 and 300),
  href text check (href is null or char_length(href) <= 1000),
  placement text not null default 'top' check (placement in ('top', 'dashboard')),
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists content_sections_visible_order_idx on public.content_sections(is_visible, sort_order);
create index if not exists articles_publication_idx on public.articles(status, published_at desc);
create index if not exists articles_section_publication_idx on public.articles(section_id, status, published_at desc);
create index if not exists announcements_active_placement_idx on public.announcements(is_active, placement, sort_order);

alter table public.content_sections enable row level security;
alter table public.articles enable row level security;
alter table public.announcements enable row level security;

drop policy if exists content_sections_public_read on public.content_sections;
create policy content_sections_public_read on public.content_sections for select to anon, authenticated using (is_visible);
drop policy if exists articles_public_read on public.articles;
create policy articles_public_read on public.articles for select to anon, authenticated using (status = 'published' and published_at is not null and published_at <= now());
drop policy if exists announcements_public_read on public.announcements;
create policy announcements_public_read on public.announcements for select to anon, authenticated using (
  is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
);

grant select on public.content_sections, public.articles, public.announcements to anon, authenticated;
revoke insert, update, delete on public.content_sections, public.articles, public.announcements from public, anon, authenticated;
grant all on public.content_sections, public.articles, public.announcements to service_role;

comment on table public.articles is 'Bilingual Markdown content exposed through the versioned content API.';
