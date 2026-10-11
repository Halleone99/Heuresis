-- Non-destructive knowledge deletion: preserve practice events and lesson links.
-- New records default to visible; no existing data is changed.
alter table public.knowledge_records
  add column if not exists deleted_at timestamptz;
create index if not exists knowledge_records_visible_owner_idx
  on public.knowledge_records (user_id, created_at desc) where deleted_at is null;
grant update (deleted_at) on public.knowledge_records to authenticated;
notify pgrst, 'reload schema';
