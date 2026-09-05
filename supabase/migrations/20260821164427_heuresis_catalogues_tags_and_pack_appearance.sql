create table if not exists public.heuresis_catalogues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,
  criteria jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists heuresis_catalogues_user_sort_idx
  on public.heuresis_catalogues(user_id, sort_order, created_at);

alter table public.heuresis_catalogues enable row level security;

drop policy if exists heuresis_catalogues_select on public.heuresis_catalogues;
create policy heuresis_catalogues_select on public.heuresis_catalogues
  for select using (user_id = (select auth.uid()));

drop policy if exists heuresis_catalogues_insert on public.heuresis_catalogues;
create policy heuresis_catalogues_insert on public.heuresis_catalogues
  for insert with check (user_id = (select auth.uid()));

drop policy if exists heuresis_catalogues_update on public.heuresis_catalogues;
create policy heuresis_catalogues_update on public.heuresis_catalogues
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists heuresis_catalogues_delete on public.heuresis_catalogues;
create policy heuresis_catalogues_delete on public.heuresis_catalogues
  for delete using (user_id = (select auth.uid()));

create or replace function public.heuresis_set_card_tags(p_card_id uuid, p_tag_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested integer := coalesce(array_length(p_tag_ids, 1), 0);
  owned integer;
begin
  if not exists (
    select 1 from public.heuresis_cards c
    where c.id = p_card_id and c.user_id = auth.uid()
  ) then
    raise exception 'Card not found';
  end if;

  select count(*) into owned
  from public.heuresis_tags t
  where t.user_id = auth.uid()
    and t.id = any(coalesce(p_tag_ids, '{}'::uuid[]));

  if owned <> requested then
    raise exception 'One or more tags are unavailable';
  end if;

  delete from public.heuresis_card_tags
  where card_id = p_card_id and user_id = auth.uid();

  insert into public.heuresis_card_tags(card_id, tag_id, user_id)
  select p_card_id, t.id, auth.uid()
  from public.heuresis_tags t
  where t.user_id = auth.uid()
    and t.id = any(coalesce(p_tag_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

revoke all on function public.heuresis_set_card_tags(uuid, uuid[]) from public;
grant execute on function public.heuresis_set_card_tags(uuid, uuid[]) to authenticated;

create or replace view public.heuresis_pack_overview
with (security_invoker = true)
as
select
  p.id,
  p.user_id,
  p.collection_id,
  p.card_type_id,
  p.default_template_id,
  p.title,
  p.description,
  p.theme,
  p.sort_order,
  p.archived_at,
  p.created_at,
  p.updated_at,
  coalesce(s.card_count, 0) as card_count,
  coalesce(s.encountered_cards, 0) as encountered_cards,
  coalesce(s.open_count, 0) as open_count,
  s.last_opened_at,
  c.title as collection_title,
  c.accent as collection_accent,
  c.glyph as collection_glyph,
  p.theme_overrides
from public.heuresis_packs p
join public.heuresis_collections c on c.id = p.collection_id
left join public.heuresis_pack_stats s on s.pack_id = p.id;
