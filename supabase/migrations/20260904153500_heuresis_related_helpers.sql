create or replace function public.heuresis_list_related_catalogue(
  p_pack_id uuid default null,
  p_source_card_id uuid default null
)
returns table (
  relation_id uuid,
  user_id uuid,
  relation_type text,
  created_at timestamptz,
  source_card_id uuid,
  pack_id uuid,
  pack_title text,
  source_term text,
  source_reading text,
  source_meaning text,
  source_tags text[],
  target_card_id uuid,
  target_role text,
  term text,
  reading text,
  meaning text
)
language sql
stable
security invoker
set search_path = 'public'
as $$
  select
    c.relation_id,
    c.user_id,
    c.relation_type,
    c.created_at,
    c.source_card_id,
    c.pack_id,
    c.pack_title,
    c.source_term,
    c.source_reading,
    c.source_meaning,
    c.source_tags,
    c.target_card_id,
    c.target_role,
    c.term,
    c.reading,
    c.meaning
  from public.heuresis_related_catalogue c
  where (p_pack_id is null or c.pack_id = p_pack_id)
    and (p_source_card_id is null or c.source_card_id = p_source_card_id)
  order by c.created_at asc, c.relation_id asc;
$$;

create or replace function public.heuresis_remove_related_relation(p_relation_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  delete from public.heuresis_card_relations
  where id = p_relation_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Related word link not found.';
  end if;
end;
$$;

grant execute on function public.heuresis_list_related_catalogue(uuid, uuid) to authenticated;
grant execute on function public.heuresis_remove_related_relation(uuid) to authenticated;
