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

  insert into public.heuresis_card_types(user_id,name,description,field_schema)
  values (auth.uid(), left(p.title || ' structure', 120), 'Custom fields for ' || p.title, p_fields)
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
