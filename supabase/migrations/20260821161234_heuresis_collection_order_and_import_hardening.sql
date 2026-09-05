drop policy if exists heuresis_packs_insert on public.heuresis_packs;
create policy heuresis_packs_insert
on public.heuresis_packs
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.heuresis_collections c
    where c.id = heuresis_packs.collection_id and c.user_id = auth.uid()
  )
  and exists (
    select 1 from public.heuresis_card_types ct
    where ct.id = heuresis_packs.card_type_id and (ct.user_id is null or ct.user_id = auth.uid())
  )
  and (
    default_template_id is null
    or exists (
      select 1 from public.heuresis_study_templates st
      where st.id = heuresis_packs.default_template_id
        and st.card_type_id = heuresis_packs.card_type_id
        and (st.user_id is null or st.user_id = auth.uid())
    )
  )
);

drop policy if exists heuresis_packs_update on public.heuresis_packs;
create policy heuresis_packs_update
on public.heuresis_packs
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.heuresis_collections c
    where c.id = heuresis_packs.collection_id and c.user_id = auth.uid()
  )
  and exists (
    select 1 from public.heuresis_card_types ct
    where ct.id = heuresis_packs.card_type_id and (ct.user_id is null or ct.user_id = auth.uid())
  )
  and (
    default_template_id is null
    or exists (
      select 1 from public.heuresis_study_templates st
      where st.id = heuresis_packs.default_template_id
        and st.card_type_id = heuresis_packs.card_type_id
        and (st.user_id is null or st.user_id = auth.uid())
    )
  )
);

create or replace function public.heuresis_reorder_collections(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  active_count integer;
  supplied_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  supplied_count := coalesce(array_length(p_ids, 1), 0);
  select count(*) into active_count
  from public.heuresis_collections
  where user_id = auth.uid() and archived_at is null;

  if supplied_count <> active_count then
    raise exception 'Collection order must include every active collection';
  end if;

  if exists (
    select 1
    from unnest(p_ids) as supplied(id)
    left join public.heuresis_collections c
      on c.id = supplied.id
     and c.user_id = auth.uid()
     and c.archived_at is null
    where c.id is null
  ) then
    raise exception 'Collection order contains an unavailable collection';
  end if;

  update public.heuresis_collections c
  set sort_order = ordered.position - 1,
      updated_at = now()
  from unnest(p_ids) with ordinality as ordered(id, position)
  where c.id = ordered.id and c.user_id = auth.uid();
end;
$$;

revoke all on function public.heuresis_reorder_collections(uuid[]) from public;
revoke all on function public.heuresis_reorder_collections(uuid[]) from anon;
grant execute on function public.heuresis_reorder_collections(uuid[]) to authenticated;

create or replace function public.heuresis_import_cards(p_pack_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted_count integer;
  row_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a JSON array'; end if;

  row_count := jsonb_array_length(p_rows);
  if row_count > 1000 then raise exception 'Import batch is too large'; end if;

  if not exists (
    select 1 from public.heuresis_packs p
    where p.id = p_pack_id and p.user_id = auth.uid() and p.archived_at is null
  ) then
    raise exception 'Pack unavailable';
  end if;

  if exists (select 1 from jsonb_array_elements(p_rows) item where jsonb_typeof(item) <> 'object') then
    raise exception 'Every imported row must be an object';
  end if;

  insert into public.heuresis_cards (user_id, pack_id, data)
  select auth.uid(), p_pack_id, item
  from jsonb_array_elements(p_rows) item;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.heuresis_import_cards(uuid, jsonb) from public;
revoke all on function public.heuresis_import_cards(uuid, jsonb) from anon;
grant execute on function public.heuresis_import_cards(uuid, jsonb) to authenticated;

create or replace function public.heuresis_update_imported_cards(p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_count integer;
  expected_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_updates) <> 'array' then raise exception 'Updates must be a JSON array'; end if;

  expected_count := jsonb_array_length(p_updates);
  if expected_count > 1000 then raise exception 'Update batch is too large'; end if;

  with incoming as (
    select id, data
    from jsonb_to_recordset(p_updates) as x(id uuid, data jsonb)
  )
  update public.heuresis_cards c
  set data = incoming.data
  from incoming
  where c.id = incoming.id and c.user_id = auth.uid();
  get diagnostics updated_count = row_count;

  if updated_count <> expected_count then
    raise exception 'One or more cards could not be updated';
  end if;
  return updated_count;
end;
$$;

revoke all on function public.heuresis_update_imported_cards(jsonb) from public;
revoke all on function public.heuresis_update_imported_cards(jsonb) from anon;
grant execute on function public.heuresis_update_imported_cards(jsonb) to authenticated;
