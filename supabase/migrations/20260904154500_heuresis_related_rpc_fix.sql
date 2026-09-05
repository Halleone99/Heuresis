-- Fix an ambiguity in the first related-word RPC and serialise same-term
-- creation so concurrent clients cannot create competing card identities.

create or replace function public.heuresis_add_related_word(
  p_source_card_id uuid,
  p_term text,
  p_reading text default null,
  p_meaning text default null,
  p_relation_type text default 'related'
)
returns table (relation_id uuid, target_card_id uuid, target_role text)
language plpgsql
security invoker
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.heuresis_cards%rowtype;
  v_target public.heuresis_cards%rowtype;
  v_relation_id uuid;
  v_term text := btrim(normalize(coalesce(p_term, ''), NFC));
  v_key text;
  v_reading text := nullif(btrim(normalize(coalesce(p_reading, ''), NFKC)), '');
  v_meaning text := nullif(btrim(coalesce(p_meaning, '')), '');
begin
  if v_uid is null then
    raise exception 'Sign in before adding related vocabulary.';
  end if;
  if v_term = '' then
    raise exception 'A word or expression is required.';
  end if;
  if p_relation_type not in ('synonym', 'antonym', 'related') then
    raise exception 'Invalid relation type.';
  end if;

  select * into v_source
  from public.heuresis_cards
  where id = p_source_card_id and user_id = v_uid;
  if not found then
    raise exception 'Source card not found.';
  end if;

  v_key := lower(btrim(normalize(v_term, NFC)));

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_source.pack_id::text || ':' || v_key, 0)
  );

  select * into v_target
  from public.heuresis_cards
  where user_id = v_uid
    and pack_id = v_source.pack_id
    and dedupe_key = v_key
  order by (role = 'main') desc, created_at asc
  limit 1;

  if not found then
    insert into public.heuresis_cards (user_id, pack_id, data, role)
    values (
      v_uid,
      v_source.pack_id,
      jsonb_strip_nulls(jsonb_build_object(
        'term', v_term,
        'reading', v_reading,
        'meaning', v_meaning
      )),
      'related'
    )
    returning * into v_target;
  else
    update public.heuresis_cards
    set data = data
      || case
        when nullif(btrim(data ->> 'reading'), '') is null and v_reading is not null
          then jsonb_build_object('reading', v_reading)
        else '{}'::jsonb
      end
      || case
        when nullif(btrim(data ->> 'meaning'), '') is null and v_meaning is not null
          then jsonb_build_object('meaning', v_meaning)
        else '{}'::jsonb
      end
    where id = v_target.id
    returning * into v_target;
  end if;

  if v_target.id = v_source.id then
    raise exception 'A card cannot be related to itself.';
  end if;

  insert into public.heuresis_card_relations (
    user_id, source_card_id, target_card_id, relation_type
  ) values (
    v_uid, v_source.id, v_target.id, p_relation_type
  )
  on conflict do nothing
  returning id into v_relation_id;

  if v_relation_id is null then
    select r.id into v_relation_id
    from public.heuresis_card_relations r
    where r.source_card_id = v_source.id
      and r.target_card_id = v_target.id
      and r.relation_type = p_relation_type
    limit 1;

    update public.heuresis_card_relations r
    set updated_at = now()
    where r.id = v_relation_id;
  end if;

  relation_id := v_relation_id;
  target_card_id := v_target.id;
  target_role := v_target.role;
  return next;
end;
$$;

revoke all on function public.heuresis_add_related_word(uuid, text, text, text, text) from public, anon;
grant execute on function public.heuresis_add_related_word(uuid, text, text, text, text) to authenticated;
