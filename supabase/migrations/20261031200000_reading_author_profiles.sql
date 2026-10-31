-- Authors are metadata for the EXISTING Personal OS reading collection.
-- No books or quotations are copied, changed, deleted or recreated.
create table if not exists public.heuresis_reading_author_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(btrim(name)) between 1 and 200 and name = btrim(name)),
  description text not null default '' check (length(description) <= 1000),
  aliases text[] not null default '{}',
  portrait_url text,
  portrait_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists heuresis_reading_author_name_per_user
  on public.heuresis_reading_author_profiles (user_id, lower(name));
create index if not exists heuresis_reading_author_profiles_owner
  on public.heuresis_reading_author_profiles (user_id);

alter table public.heuresis_reading_author_profiles enable row level security;
drop policy if exists heuresis_reading_authors_select on public.heuresis_reading_author_profiles;
create policy heuresis_reading_authors_select on public.heuresis_reading_author_profiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists heuresis_reading_authors_insert on public.heuresis_reading_author_profiles;
create policy heuresis_reading_authors_insert on public.heuresis_reading_author_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists heuresis_reading_authors_update on public.heuresis_reading_author_profiles;
create policy heuresis_reading_authors_update on public.heuresis_reading_author_profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists heuresis_reading_authors_delete on public.heuresis_reading_author_profiles;
create policy heuresis_reading_authors_delete on public.heuresis_reading_author_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.heuresis_reading_author_profiles from public, anon, authenticated;
grant select, insert, delete on public.heuresis_reading_author_profiles to authenticated;
grant update (name, description, aliases, portrait_url, portrait_path, updated_at)
  on public.heuresis_reading_author_profiles to authenticated;

-- Separate private storage. Every object is constrained to the current user's folder.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('heuresis-reading-media','heuresis-reading-media',false,10485760,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists heuresis_author_images_select on storage.objects;
create policy heuresis_author_images_select on storage.objects
  for select to authenticated
  using (bucket_id = 'heuresis-reading-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists heuresis_author_images_insert on storage.objects;
create policy heuresis_author_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'heuresis-reading-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists heuresis_author_images_delete on storage.objects;
create policy heuresis_author_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'heuresis-reading-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
