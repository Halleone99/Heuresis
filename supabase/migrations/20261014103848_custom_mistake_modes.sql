-- User-configurable Mistake Log modes, shared across devices.
-- Additive: existing notes, mistakes and practice history are untouched.
-- A removed custom mode only nulls the assignment; mistake and recall rows remain.
create table if not exists public.knowledge_mistake_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 220),
  symbol text not null default '🧠' check (char_length(symbol) between 1 and 60),
  sort_order integer not null default 0,
  legacy_category text check (legacy_category is null or legacy_category in ('grammar','vocabulary','phrase','note')),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, legacy_category)
);
alter table public.knowledge_mistake_modes enable row level security;
create policy "mistake_modes_select_own" on public.knowledge_mistake_modes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "mistake_modes_insert_own" on public.knowledge_mistake_modes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "mistake_modes_update_own" on public.knowledge_mistake_modes
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "mistake_modes_delete_own" on public.knowledge_mistake_modes
  for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.knowledge_mistake_modes to authenticated;
alter table public.knowledge_records
  add column if not exists mistake_mode_id uuid;
alter table public.knowledge_records
  add constraint knowledge_records_owner_mistake_mode_fk
    foreign key (mistake_mode_id, user_id)
    references public.knowledge_mistake_modes (id, user_id)
    on delete set null (mistake_mode_id);
alter table public.knowledge_records
  add constraint knowledge_records_mistake_mode_only
    check (mistake_mode_id is null or kind = 'mistake');
create index if not exists knowledge_records_mistake_mode_id_idx
  on public.knowledge_records (mistake_mode_id, user_id)
  where mistake_mode_id is not null;
notify pgrst, 'reload schema';
