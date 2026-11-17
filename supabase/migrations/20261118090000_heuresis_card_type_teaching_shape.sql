-- How a card type is taught, stated explicitly (teaching_shape), instead of being guessed from
-- its field roles. Additive and safe to run more than once:
--   * one nullable column; null means the standard exercises (every existing type stays as it is);
--   * the built-in Rule — Applied type is marked 'rule';
--   * customising a topic's card fields keeps the topic's teaching shape. The function below is
--     the existing heuresis_customize_pack_structure with only that addition (same signature,
--     same grants, same behaviour otherwise).
-- Future knowledge modes add values (for example 'fact', 'idea'); clients treat unknown values
-- as standard.

alter table public.heuresis_card_types
  add column if not exists teaching_shape text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'heuresis_card_types_teaching_shape_format') then
    alter table public.heuresis_card_types
      add constraint heuresis_card_types_teaching_shape_format
      check (teaching_shape is null or teaching_shape ~ '^[a-z][a-z_]{1,23}$');
  end if;
end
$$;

comment on column public.heuresis_card_types.teaching_shape is
  'How cards of this type are taught in Learn: null = standard exercises, ''rule'' = Applied (rules, procedures, cases).';

update public.heuresis_card_types
   set teaching_shape = 'rule'
 where id = '00000000-0000-4000-8000-000000000006'
   and teaching_shape is distinct from 'rule';

-- Clearer labels for the case fields of the built-in Rule type (keys and roles unchanged, so
-- existing cards are unaffected): an outcome may carry its reason after a colon.
update public.heuresis_card_types
   set field_schema = (
         select jsonb_agg(case
                  when f->>'key' = 'case' then jsonb_set(f, '{label}', '"A case: a realistic situation"')
                  when f->>'key' = 'outcome' then jsonb_set(f, '{label}', '"What follows, and why (after a colon)"')
                  else f end order by ord)
           from jsonb_array_elements(field_schema) with ordinality as e(f, ord)),
       updated_at = now()
 where id = '00000000-0000-4000-8000-000000000006'
   and exists (select 1 from jsonb_array_elements(field_schema) f
                where (f->>'key' = 'case' and f->>'label' <> 'A case: a realistic situation')
                   or (f->>'key' = 'outcome' and f->>'label' <> 'What follows, and why (after a colon)'));

create or replace function public.heuresis_customize_pack_structure(p_pack_id uuid, p_fields jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  p public.heuresis_packs%rowtype;
  new_type_id uuid;
  forward_template_id uuid;
  field_count integer;
  term_keys jsonb;
  meaning_keys jsonb;
  reading_keys jsonb;
  detail_keys jsonb;
  current_shape text;
  forward_front jsonb;
  forward_back jsonb;
  reverse_front jsonb;
  reverse_back jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_fields) <> 'array' then raise exception 'Fields must be an array'; end if;
  field_count := jsonb_array_length(p_fields);
  if field_count < 2 or field_count > 20 then raise exception 'A card structure needs between 2 and 20 fields'; end if;

  select * into p from public.heuresis_packs where id = p_pack_id and user_id = auth.uid() and archived_at is null;
  if not found then raise exception 'Pack unavailable'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_fields) f
    where jsonb_typeof(f) <> 'object'
       or nullif(trim(f->>'key'),'') is null
       or nullif(trim(f->>'label'),'') is null
  ) then raise exception 'Every field needs a key and label'; end if;

  if exists (
    select 1 from (
      select lower(f->>'key') k, count(*) c from jsonb_array_elements(p_fields) f group by lower(f->>'key') having count(*) > 1
    ) duplicates
  ) then raise exception 'Field keys must be unique'; end if;

  -- A customised Applied (or any shaped) topic stays what it was: its teaching shape is kept.
  select ct.teaching_shape into current_shape from public.heuresis_card_types ct where ct.id = p.card_type_id;

  insert into public.heuresis_card_types(user_id,name,description,field_schema,teaching_shape)
  values (auth.uid(), left(p.title || ' structure', 120), 'Custom fields for ' || p.title, p_fields, current_shape)
  returning id into new_type_id;

  select coalesce(jsonb_agg(to_jsonb(f->>'key')) filter (where f->>'role'='term'), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(f->>'key')) filter (where f->>'role'='meaning'), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(f->>'key')) filter (where f->>'role'='reading'), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(f->>'key')) filter (where coalesce(f->>'role','extra') not in ('term','meaning','reading')), '[]'::jsonb)
  into term_keys, meaning_keys, reading_keys, detail_keys
  from jsonb_array_elements(p_fields) f;

  if jsonb_array_length(term_keys)=0 then term_keys := jsonb_build_array((p_fields->0)->>'key'); end if;
  if jsonb_array_length(meaning_keys)=0 then meaning_keys := jsonb_build_array((p_fields->1)->>'key'); end if;

  forward_front := term_keys || reading_keys;
  forward_back := meaning_keys;
  reverse_front := meaning_keys;
  reverse_back := term_keys || reading_keys;

  insert into public.heuresis_study_templates(user_id,card_type_id,name,front,back,details,sort_order)
  values (auth.uid(),new_type_id,'Forward',forward_front,forward_back,detail_keys,0)
  returning id into forward_template_id;

  insert into public.heuresis_study_templates(user_id,card_type_id,name,front,back,details,sort_order)
  values (auth.uid(),new_type_id,'Reverse',reverse_front,reverse_back,detail_keys,1);

  update public.heuresis_packs
  set card_type_id = new_type_id,
      default_template_id = forward_template_id,
      updated_at = now()
  where id = p_pack_id and user_id = auth.uid();

  return new_type_id;
end;
$$;

revoke all on function public.heuresis_customize_pack_structure(uuid,jsonb) from public;
grant execute on function public.heuresis_customize_pack_structure(uuid,jsonb) to authenticated;
