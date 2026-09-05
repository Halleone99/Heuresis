insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'heuresis-card-media',
  'heuresis-card-media',
  false,
  12582912,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists heuresis_card_media_select on storage.objects;
create policy heuresis_card_media_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'heuresis-card-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists heuresis_card_media_insert on storage.objects;
create policy heuresis_card_media_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'heuresis-card-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists heuresis_card_media_update on storage.objects;
create policy heuresis_card_media_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'heuresis-card-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'heuresis-card-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists heuresis_card_media_delete on storage.objects;
create policy heuresis_card_media_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'heuresis-card-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
