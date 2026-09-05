create or replace function public.heuresis_field_key(p_field_schema jsonb, p_role text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public
as $$
  select item ->> 'key'
  from jsonb_array_elements(p_field_schema) with ordinality as fields(item, ord)
  where item ->> 'role' = p_role
    and nullif(btrim(item ->> 'key'), '') is not null
  order by ord
  limit 1
$$;

revoke all on function public.heuresis_field_key(jsonb, text) from public, anon;
grant execute on function public.heuresis_field_key(jsonb, text) to authenticated;

alter table public.heuresis_cards alter column dedupe_key drop expression;

update public.heuresis_cards c
set dedupe_key = lower(btrim(normalize(coalesce(c.data ->> public.heuresis_field_key(ct.field_schema, 'term'), ''), NFC)))
from public.heuresis_packs p
join public.heuresis_card_types ct on ct.id = p.card_type_id
where p.id = c.pack_id;

create or replace function public.heuresis_set_card_dedupe_key()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_field_schema jsonb;
  v_term_key text;
begin
  select ct.field_schema into v_field_schema
  from public.heuresis_packs p
  join public.heuresis_card_types ct on ct.id = p.card_type_id
  where p.id = new.pack_id
    and p.user_id = new.user_id;

  if v_field_schema is null then raise exception 'Card pack or card type unavailable'; end if;
  v_term_key := public.heuresis_field_key(v_field_schema, 'term');
  if v_term_key is null then raise exception 'Card type has no term field'; end if;
  new.dedupe_key := lower(btrim(normalize(coalesce(new.data ->> v_term_key, ''), NFC)));
  return new;
end;
$$;
revoke all on function public.heuresis_set_card_dedupe_key() from public, anon, authenticated;
drop trigger if exists heuresis_card_dedupe_key on public.heuresis_cards;
create trigger heuresis_card_dedupe_key
before insert or update of data, pack_id on public.heuresis_cards
for each row execute function public.heuresis_set_card_dedupe_key();

create or replace view public.heuresis_related_catalogue
with (security_invoker = true) as
select
  r.id as relation_id,
  r.user_id,
  r.relation_type,
  r.created_at,
  src.id as source_card_id,
  src.pack_id,
  src_pack.title as pack_title,
  src.data ->> public.heuresis_field_key(src_type.field_schema, 'term') as source_term,
  case when public.heuresis_field_key(src_type.field_schema, 'reading') is null then null else src.data ->> public.heuresis_field_key(src_type.field_schema, 'reading') end as source_reading,
  case when public.heuresis_field_key(src_type.field_schema, 'meaning') is null then null else src.data ->> public.heuresis_field_key(src_type.field_schema, 'meaning') end as source_meaning,
  coalesce(tag_data.source_tags, array[]::text[]) as source_tags,
  tgt.id as target_card_id,
  tgt.role as target_role,
  tgt.data ->> public.heuresis_field_key(tgt_type.field_schema, 'term') as term,
  case when public.heuresis_field_key(tgt_type.field_schema, 'reading') is null then null else tgt.data ->> public.heuresis_field_key(tgt_type.field_schema, 'reading') end as reading,
  case when public.heuresis_field_key(tgt_type.field_schema, 'meaning') is null then null else tgt.data ->> public.heuresis_field_key(tgt_type.field_schema, 'meaning') end as meaning
from public.heuresis_card_relations r
join public.heuresis_cards src on src.id = r.source_card_id
join public.heuresis_packs src_pack on src_pack.id = src.pack_id
join public.heuresis_card_types src_type on src_type.id = src_pack.card_type_id
join public.heuresis_cards tgt on tgt.id = r.target_card_id
join public.heuresis_packs tgt_pack on tgt_pack.id = tgt.pack_id
join public.heuresis_card_types tgt_type on tgt_type.id = tgt_pack.card_type_id
left join lateral (
  select array_agg(t.name order by t.sort_order, t.name) as source_tags
  from public.heuresis_card_tags ct
  join public.heuresis_tags t on t.id = ct.tag_id
  where ct.card_id = src.id
) tag_data on true;
grant select on public.heuresis_related_catalogue to authenticated;

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
set search_path = public
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
  if v_uid is null then raise exception 'Sign in before adding related vocabulary.'; end if;
  if v_term = '' then raise exception 'A word or expression is required.'; end if;
  if p_relation_type not in ('synonym', 'antonym', 'related') then raise exception 'Invalid relation type.'; end if;

  select c.* into v_source from public.heuresis_cards c where c.id = p_source_card_id and c.user_id = v_uid;
  if not found then raise exception 'Source card not found.'; end if;
  select ct.field_schema into v_schema
  from public.heuresis_packs p
  join public.heuresis_card_types ct on ct.id = p.card_type_id
  where p.id = v_source.pack_id and p.user_id = v_uid;
  if v_schema is null then raise exception 'Source card type unavailable.'; end if;

  v_term_key := public.heuresis_field_key(v_schema, 'term');
  v_reading_key := public.heuresis_field_key(v_schema, 'reading');
  v_meaning_key := public.heuresis_field_key(v_schema, 'meaning');
  if v_term_key is null then raise exception 'This card type has no term field.'; end if;

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

  if v_target.id = v_source.id then raise exception 'A card cannot be related to itself.'; end if;
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
revoke all on function public.heuresis_add_related_word(uuid,text,text,text,text) from public, anon;
grant execute on function public.heuresis_add_related_word(uuid,text,text,text,text) to authenticated;

create or replace function public.heuresis_patch_card_data(p_card_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_data jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Card data patch must be a JSON object'; end if;
  update public.heuresis_cards set data = data || p_patch
  where id = p_card_id and user_id = auth.uid() returning data into v_data;
  if v_data is null then raise exception 'Card unavailable'; end if;
  return v_data;
end;
$$;
revoke all on function public.heuresis_patch_card_data(uuid,jsonb) from public, anon;
grant execute on function public.heuresis_patch_card_data(uuid,jsonb) to authenticated;

create or replace function public.heuresis_cleanup_orphan_related_target()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.heuresis_cards c
  where c.id = old.target_card_id and c.user_id = old.user_id and c.role = 'related'
    and not exists (select 1 from public.heuresis_card_relations r where r.target_card_id = c.id);
  return old;
end;
$$;
revoke all on function public.heuresis_cleanup_orphan_related_target() from public, anon, authenticated;
drop trigger if exists heuresis_cleanup_orphan_related_target on public.heuresis_card_relations;
create trigger heuresis_cleanup_orphan_related_target
after delete on public.heuresis_card_relations
for each row execute function public.heuresis_cleanup_orphan_related_target();

create or replace function public.heuresis_related_counts()
returns table (pack_id uuid, relation_count bigint, word_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select src.pack_id, count(*)::bigint, count(distinct r.target_card_id)::bigint
  from public.heuresis_card_relations r
  join public.heuresis_cards src on src.id = r.source_card_id
  where r.user_id = auth.uid()
  group by src.pack_id
$$;
revoke all on function public.heuresis_related_counts() from public, anon;
grant execute on function public.heuresis_related_counts() to authenticated;
