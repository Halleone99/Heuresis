create or replace function public.heuresis_create_topic_from_related_words(
  p_collection_id uuid,
  p_title text,
  p_card_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
  v_type_count integer;
  v_card_type uuid;
  v_pack_id uuid;
  v_sort integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Give the new topic a name.'; end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_card_ids, '{}'::uuid[])) as x;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Select at least one word.'; end if;

  if not exists (
    select 1 from public.heuresis_collections c
    where c.id = p_collection_id and c.user_id = v_user and c.archived_at is null
  ) then raise exception 'Collection not found.'; end if;

  select count(*), count(distinct p.card_type_id), min(p.card_type_id)
    into v_count, v_type_count, v_card_type
  from public.heuresis_cards c
  join public.heuresis_packs p on p.id = c.pack_id and p.user_id = v_user
  where c.user_id = v_user
    and c.id = any(v_ids)
    and p.collection_id = p_collection_id;

  if v_count <> cardinality(v_ids) then raise exception 'Some selected words no longer belong to this collection.'; end if;
  if v_type_count <> 1 then raise exception 'Selected words use different card types. Create separate topics for each type.'; end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.heuresis_packs
  where user_id = v_user and collection_id = p_collection_id;

  insert into public.heuresis_packs(user_id, collection_id, card_type_id, title, description, sort_order)
  values (v_user, p_collection_id, v_card_type, trim(p_title), 'Words promoted from New words.', v_sort)
  returning id into v_pack_id;

  update public.heuresis_cards
  set pack_id = v_pack_id, role = 'main', updated_at = now()
  where user_id = v_user and id = any(v_ids);

  return v_pack_id;
end;
$$;

revoke all on function public.heuresis_create_topic_from_related_words(uuid,text,uuid[]) from public;
grant execute on function public.heuresis_create_topic_from_related_words(uuid,text,uuid[]) to authenticated;
