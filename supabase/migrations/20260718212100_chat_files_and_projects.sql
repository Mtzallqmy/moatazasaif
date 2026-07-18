-- Private chat files and editable AI projects.
-- Browser clients never receive service-role access or raw storage paths.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files',
  'chat-files',
  false,
  3145728,
  array[
    'image/png','image/jpeg','image/webp',
    'text/plain','text/markdown','application/json','text/csv',
    'text/tab-separated-values','application/xml','text/xml',
    'application/yaml','text/yaml','application/x-yaml',
    'application/sql','text/javascript','application/javascript',
    'text/typescript','application/typescript','text/x-python',
    'text/html','text/css','text/x-shellscript'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.chat_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  message_id uuid not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  kind text not null check (kind in ('image','text')),
  size_bytes integer not null check (size_bytes between 1 and 3145728),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint chat_files_name_check check (
    char_length(original_name) between 1 and 200
    and original_name !~ '[\x00-\x1F\x7F]'
  ),
  constraint chat_files_mime_check check (mime_type in (
    'image/png','image/jpeg','image/webp',
    'text/plain','text/markdown','application/json','text/csv',
    'text/tab-separated-values','application/xml','text/xml',
    'application/yaml','text/yaml','application/x-yaml',
    'application/sql','text/javascript','application/javascript',
    'text/typescript','application/typescript','text/x-python',
    'text/html','text/css','text/x-shellscript'
  )),
  constraint chat_files_storage_path_check check (
    storage_path like user_id::text || '/' || chat_id::text || '/%'
    and storage_path !~ '(^|/)\.\.(/|$)'
  )
);

create index if not exists chat_files_chat_created_idx
  on public.chat_files(chat_id, created_at);
create index if not exists chat_files_user_created_idx
  on public.chat_files(user_id, created_at desc);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  template text not null default 'empty'
    check (template in ('empty','vite-react','node-api','python')),
  status text not null default 'active'
    check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null,
  content text not null default '',
  mime_type text not null default 'text/plain',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, path),
  constraint project_files_path_check check (
    char_length(path) between 1 and 240
    and path !~ '^/'
    and path !~ '(^|/)\.\.(/|$)'
    and path !~ '[\x00-\x1F\x7F]'
  ),
  constraint project_files_content_check check (octet_length(content) <= 2097152),
  constraint project_files_mime_check check (char_length(mime_type) between 1 and 120)
);

create index if not exists projects_user_updated_idx
  on public.projects(user_id, updated_at desc);
create index if not exists project_files_project_path_idx
  on public.project_files(project_id, path);
create index if not exists project_files_user_idx
  on public.project_files(user_id);

alter table public.chat_files enable row level security;
alter table public.projects enable row level security;
alter table public.project_files enable row level security;

-- These records are served only by authenticated same-origin API handlers.
-- Keeping browser grants revoked prevents accidental Data API exposure.
revoke all on public.chat_files, public.projects, public.project_files
  from public, anon, authenticated;
grant all on public.chat_files, public.projects, public.project_files
  to service_role;

-- Defense-in-depth policies for future direct authenticated access. Grants
-- remain revoked until that access path is intentionally enabled.
drop policy if exists chat_files_owner_all on public.chat_files;
create policy chat_files_owner_all on public.chat_files
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists projects_owner_all on public.projects;
create policy projects_owner_all on public.projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists project_files_owner_all on public.project_files;
create policy project_files_owner_all on public.project_files
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.projects project
      where project.id = project_id
        and project.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.projects project
      where project.id = project_id
        and project.user_id = (select auth.uid())
    )
  );
