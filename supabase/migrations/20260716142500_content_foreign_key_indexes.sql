create index if not exists content_sections_created_by_idx
  on public.content_sections(created_by) where created_by is not null;

create index if not exists articles_author_id_idx
  on public.articles(author_id) where author_id is not null;

create index if not exists announcements_created_by_idx
  on public.announcements(created_by) where created_by is not null;
