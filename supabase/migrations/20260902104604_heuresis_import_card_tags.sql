create or replace function public.heuresis_import_cards_with_tags(p_pack_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  inserted_card_id uuid;
  raw_tag_id text;
  parsed_tag_id uuid;
  inserted_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a JSON array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Import batch is too large'; end if;

  if not exists (
    select 1 from public.heuresis_packs p
    where p.id = p_pack_id and p.user_id = auth.uid() and p.archived_at is null
  ) then
    raise exception 'Pack unavailable';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'Every imported row must be an object';
    end if;
    if jsonb_typeof(item -> 'data') <> 'object' then
      raise exception 'Every imported row must contain card data';
    end if;
    if item ? 'tag_ids' and jsonb_typeof(item -> 'tag_ids') <> 'array' then
      raise exception 'tag_ids must be an array';
    end if;

    insert into public.heuresis_cards (user_id, pack_id, data)
    values (auth.uid(), p_pack_id, item -> 'data')
    returning id into inserted_card_id;

    for raw_tag_id in
      select value from jsonb_array_elements_text(coalesce(item -> 'tag_ids', '[]'::jsonb))
    loop
      begin
        parsed_tag_id := raw_tag_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid tag id in imported row';
      end;

      if not exists (
        select 1 from public.heuresis_tags t
        where t.id = parsed_tag_id and t.user_id = auth.uid()
      ) then
        raise exception 'Imported tag is unavailable';
      end if;

      insert into public.heuresis_card_tags (card_id, tag_id, user_id)
      values (inserted_card_id, parsed_tag_id, auth.uid())
      on conflict do nothing;
    end loop;

    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;

revoke all on function public.heuresis_import_cards_with_tags(uuid, jsonb) from public;
revoke all on function public.heuresis_import_cards_with_tags(uuid, jsonb) from anon;
grant execute on function public.heuresis_import_cards_with_tags(uuid, jsonb) to authenticated;
