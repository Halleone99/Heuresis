-- Catalogue: independent, designed publications (A4 articles, volumes, subjects).
--
-- Additive and non-destructive:
--   * new tables only; knowledge_* (Notebook) tables and rows are not touched;
--   * nothing is migrated from the Notebook — a Catalogue article is created
--     only by an explicit action, as a copy of the note's text;
--   * catalogue_articles.source_note_id is provenance only, deliberately WITHOUT
--     a foreign key, so editing or deleting the source note cannot affect it;
--   * a separate private storage bucket, so the flashcard image bucket and its
--     policies are unchanged.
-- Safe to run more than once.

create or replace function public.catalogue_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.catalogue_touch() from public, anon, authenticated;

create table if not exists public.catalogue_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists catalogue_subjects_owner_name_idx
  on public.catalogue_subjects(user_id, lower(name));

create table if not exists public.catalogue_volumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid,
  title text not null check (title = btrim(title) and length(title) between 1 and 200),
  subtitle text not null default '' check (length(subtitle) <= 300),
  edition text not null default '' check (length(edition) <= 80),
  edition_date date,
  cover jsonb check (cover is null or jsonb_typeof(cover) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- Removing a subject never removes its volumes; they simply lose the subject.
  constraint catalogue_volumes_subject_fk foreign key (subject_id, user_id)
    references public.catalogue_subjects(id, user_id) on delete set null (subject_id)
);
create index if not exists catalogue_volumes_owner_idx on public.catalogue_volumes(user_id);
create index if not exists catalogue_volumes_subject_idx on public.catalogue_volumes(subject_id);

create table if not exists public.catalogue_articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  subtitle text not null default '' check (length(subtitle) <= 300),
  author text not null default '' check (length(author) <= 120),
  subject_id uuid,
  volume_id uuid,
  volume_order integer not null default 0,
  -- Provenance only (no foreign key): the article is an independent copy.
  source_note_id uuid,
  source_kind text not null default 'blank' check (source_kind in ('blank', 'notebook', 'docx')),
  source_label text not null default '' check (length(source_label) <= 300),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  typography_preset text not null default 'classical' check (typography_preset in ('classical', 'literary', 'archive')),
  colour_preset text not null default 'warm' check (colour_preset in ('warm', 'white', 'dark')),
  page_numbers boolean not null default true,
  running_header boolean not null default false,
  cover jsonb check (cover is null or jsonb_typeof(cover) = 'object'),
  -- Ordered A4 pages, each { id, blocks: [...] }. Position = array index.
  pages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) <= 400 and octet_length(pages::text) <= 2000000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint catalogue_articles_subject_fk foreign key (subject_id, user_id)
    references public.catalogue_subjects(id, user_id) on delete set null (subject_id),
  constraint catalogue_articles_volume_fk foreign key (volume_id, user_id)
    references public.catalogue_volumes(id, user_id) on delete set null (volume_id)
);
create index if not exists catalogue_articles_owner_recent_idx on public.catalogue_articles(user_id, updated_at desc);
create index if not exists catalogue_articles_subject_idx on public.catalogue_articles(subject_id);
create index if not exists catalogue_articles_volume_idx on public.catalogue_articles(volume_id, volume_order);

drop trigger if exists catalogue_subject_touch on public.catalogue_subjects;
create trigger catalogue_subject_touch before update on public.catalogue_subjects
  for each row execute function public.catalogue_touch();
drop trigger if exists catalogue_volume_touch on public.catalogue_volumes;
create trigger catalogue_volume_touch before update on public.catalogue_volumes
  for each row execute function public.catalogue_touch();
drop trigger if exists catalogue_article_touch on public.catalogue_articles;
create trigger catalogue_article_touch before update on public.catalogue_articles
  for each row execute function public.catalogue_touch();

alter table public.catalogue_subjects enable row level security;
alter table public.catalogue_volumes enable row level security;
alter table public.catalogue_articles enable row level security;

drop policy if exists catalogue_subjects_owner on public.catalogue_subjects;
create policy catalogue_subjects_owner on public.catalogue_subjects
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists catalogue_volumes_owner on public.catalogue_volumes;
create policy catalogue_volumes_owner on public.catalogue_volumes
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists catalogue_articles_owner on public.catalogue_articles;
create policy catalogue_articles_owner on public.catalogue_articles
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.catalogue_subjects, public.catalogue_volumes, public.catalogue_articles
  from public, anon, authenticated;
grant select, insert, delete on public.catalogue_subjects, public.catalogue_volumes, public.catalogue_articles to authenticated;
-- Ownership (user_id), identity (id) and creation time are never updatable.
grant update (name, sort_order) on public.catalogue_subjects to authenticated;
grant update (subject_id, title, subtitle, edition, edition_date, cover, sort_order)
  on public.catalogue_volumes to authenticated;
grant update (title, subtitle, author, subject_id, volume_id, volume_order, status, published_at,
  typography_preset, colour_preset, page_numbers, running_header, cover, pages, deleted_at)
  on public.catalogue_articles to authenticated;

-- Private images for Catalogue pages, in each account's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'heuresis-catalogue-media',
  'heuresis-catalogue-media',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists heuresis_catalogue_media_select on storage.objects;
create policy heuresis_catalogue_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'heuresis-catalogue-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists heuresis_catalogue_media_insert on storage.objects;
create policy heuresis_catalogue_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'heuresis-catalogue-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists heuresis_catalogue_media_update on storage.objects;
create policy heuresis_catalogue_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'heuresis-catalogue-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'heuresis-catalogue-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists heuresis_catalogue_media_delete on storage.objects;
create policy heuresis_catalogue_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'heuresis-catalogue-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
