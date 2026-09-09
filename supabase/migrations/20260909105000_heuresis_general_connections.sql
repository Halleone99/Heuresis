alter table public.heuresis_card_relations
  drop constraint if exists heuresis_card_relations_relation_type_check;

alter table public.heuresis_card_relations
  add constraint heuresis_card_relations_relation_type_check
  check (relation_type in (
    'synonym', 'antonym', 'related',
    'part_of', 'depends_on', 'contrasts_with', 'example_of'
  ));

create or replace function public.heuresis_connect_cards(
  p_source_card_id uuid,
  p_target_card_id uuid,
  p_relation_type text default 'related'
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_relation_id uuid;
begin
  if v_uid is null then raise exception 'Sign in before adding a connection.'; end if;
  if p_source_card_id = p_target_card_id then raise exception 'An entry cannot connect to itself.'; end if;
  if p_relation_type not in ('synonym', 'antonym', 'related', 'part_of', 'depends_on', 'contrasts_with', 'example_of') then
    raise exception 'Invalid relation type.';
  end if;

  if not exists (select 1 from public.heuresis_cards c where c.id = p_source_card_id and c.user_id = v_uid) then
    raise exception 'Source entry not found.';
  end if;
  if not exists (select 1 from public.heuresis_cards c where c.id = p_target_card_id and c.user_id = v_uid) then
    raise exception 'Target entry not found.';
  end if;

  insert into public.heuresis_card_relations (user_id, source_card_id, target_card_id, relation_type)
  values (v_uid, p_source_card_id, p_target_card_id, p_relation_type)
  on conflict (source_card_id, target_card_id, relation_type)
  do update set updated_at = now()
  returning id into v_relation_id;

  return v_relation_id;
end;
$$;

grant execute on function public.heuresis_connect_cards(uuid, uuid, text) to authenticated;

create or replace function public.heuresis_add_related_word(
  p_source_card_id uuid,
  p_term text,
  p_reading text default null,
  p_meaning text default null,
  p_relation_type text default 'related'
)
returns table (relation_id uuid, target_card_id uuid, target_role text)
language plpgsql
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.heuresis_cards%rowtype;
  v_target public.heuresis_cards%rowtype;
  v_relation_id uuid;
  v_schema jsonb;
  v_term_key text;
  v_reading_key text;
  v_meaning_key text;
  v_data jsonb;
  v_term text := btrim(normalize(coalesce(p_term, ''), NFC));
  v_key text;
  v_reading text := nullif(btrim(normalize(coalesce(p_reading, ''), NFKC)), '');
  v_meaning text := nullif(btrim(coalesce(p_meaning, '')), '');
begin
  if v_uid is null then raise exception 'Sign in before adding a connection.'; end if;
  if v_term = '' then raise exception 'An entry is required.'; end if;
  if p_relation_type not in ('synonym', 'antonym', 'related', 'part_of', 'depends_on', 'contrasts_with', 'example_of') then raise exception 'Invalid relation type.'; end if;

  select c.* into v_source from public.heuresis_cards c where c.id = p_source_card_id and c.user_id = v_uid;
  if not found then raise exception 'Source entry not found.'; end if;
  select ct.field_schema into v_schema
  from public.heuresis_packs p
  join public.heuresis_card_types ct on ct.id = p.card_type_id
  where p.id = v_source.pack_id and p.user_id = v_uid;
  if v_schema is null then raise exception 'Source card type unavailable.'; end if;

  v_term_key := public.heuresis_field_key(v_schema, 'term');
  v_reading_key := public.heuresis_field_key(v_schema, 'reading');
  v_meaning_key := public.heuresis_field_key(v_schema, 'meaning');
  if v_term_key is null then raise exception 'This card type has no primary field.'; end if;

  v_key := lower(btrim(normalize(v_term, NFC)));
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_source.pack_id::text || ':' || v_key, 0));

  select * into v_target from public.heuresis_cards
  where user_id = v_uid and pack_id = v_source.pack_id and dedupe_key = v_key
  order by (role = 'main') desc, created_at asc limit 1;

  if not found then
    v_data := jsonb_build_object(v_term_key, v_term);
    if v_reading_key is not null and v_reading is not null then v_data := v_data || jsonb_build_object(v_reading_key, v_reading); end if;
    if v_meaning_key is not null and v_meaning is not null then v_data := v_data || jsonb_build_object(v_meaning_key, v_meaning); end if;
    insert into public.heuresis_cards (user_id, pack_id, data, role)
    values (v_uid, v_source.pack_id, v_data, 'related') returning * into v_target;
  else
    v_data := '{}'::jsonb;
    if v_reading_key is not null and v_reading is not null and nullif(btrim(v_target.data ->> v_reading_key), '') is null then v_data := v_data || jsonb_build_object(v_reading_key, v_reading); end if;
    if v_meaning_key is not null and v_meaning is not null and nullif(btrim(v_target.data ->> v_meaning_key), '') is null then v_data := v_data || jsonb_build_object(v_meaning_key, v_meaning); end if;
    if v_data <> '{}'::jsonb then update public.heuresis_cards set data = data || v_data where id = v_target.id returning * into v_target; end if;
  end if;

  if v_target.id = v_source.id then raise exception 'An entry cannot connect to itself.'; end if;
  insert into public.heuresis_card_relations (user_id, source_card_id, target_card_id, relation_type)
  values (v_uid, v_source.id, v_target.id, p_relation_type)
  on conflict do nothing returning id into v_relation_id;

  if v_relation_id is null then
    select r.id into v_relation_id from public.heuresis_card_relations r
    where r.source_card_id = v_source.id and r.target_card_id = v_target.id and r.relation_type = p_relation_type limit 1;
    update public.heuresis_card_relations set updated_at = now() where id = v_relation_id;
  end if;
  relation_id := v_relation_id; target_card_id := v_target.id; target_role := v_target.role; return next;
end;
$$;

grant execute on function public.heuresis_add_related_word(uuid, text, text, text, text) to authenticated;
