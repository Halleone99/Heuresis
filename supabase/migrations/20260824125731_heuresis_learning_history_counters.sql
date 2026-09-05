alter table public.heuresis_card_events
  drop constraint if exists heuresis_card_events_event_type_check;

alter table public.heuresis_card_events
  add constraint heuresis_card_events_event_type_check
  check (event_type = any (array[
    'encountered'::text,
    'revealed'::text,
    'known'::text,
    'again'::text,
    'hard'::text,
    'good'::text,
    'easy'::text,
    'favourited'::text,
    'unfavourited'::text,
    'marked_interesting'::text,
    'unmarked_interesting'::text,
    'exercise_write'::text,
    'exercise_handwrite'::text,
    'exercise_type'::text,
    'exercise_sentence'::text,
    'exercise_rephrase'::text,
    'exercise_example'::text,
    'exercise_say'::text,
    'exercise_hear'::text
  ]));

update public.heuresis_card_events
set event_type = 'exercise_handwrite'
where event_type = 'exercise_write';

create or replace function public.heuresis_learning_counts(p_card_ids uuid[])
returns table(card_id uuid, action text, action_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.card_id,
    case e.event_type
      when 'exercise_handwrite' then 'handwrite'
      when 'exercise_type' then 'type'
      when 'exercise_sentence' then 'sentence'
      when 'exercise_rephrase' then 'rephrase'
      when 'exercise_example' then 'example'
      when 'exercise_say' then 'say'
      when 'exercise_hear' then 'hear'
    end as action,
    count(*)::bigint as action_count
  from public.heuresis_card_events e
  where e.user_id = (select auth.uid())
    and e.card_id = any(p_card_ids)
    and e.event_type in (
      'exercise_handwrite','exercise_type','exercise_sentence','exercise_rephrase',
      'exercise_example','exercise_say','exercise_hear'
    )
  group by e.card_id, e.event_type;
$$;

create or replace function public.heuresis_toggle_learning_action(
  p_card_id uuid,
  p_pack_id uuid,
  p_session_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event_type text;
  v_event_id uuid;
  v_selected boolean;
  v_count bigint;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;

  v_event_type := case p_action
    when 'handwrite' then 'exercise_handwrite'
    when 'type' then 'exercise_type'
    when 'sentence' then 'exercise_sentence'
    when 'rephrase' then 'exercise_rephrase'
    when 'example' then 'exercise_example'
    when 'say' then 'exercise_say'
    when 'hear' then 'exercise_hear'
    else null
  end;

  if v_event_type is null then
    raise exception 'Unknown learning action';
  end if;

  if not exists (
    select 1
    from public.heuresis_cards c
    join public.heuresis_packs p on p.id = c.pack_id
    where c.id = p_card_id
      and c.pack_id = p_pack_id
      and c.user_id = v_user
      and p.user_id = v_user
  ) then
    raise exception 'Card does not belong to this user or pack';
  end if;

  if not exists (
    select 1
    from public.heuresis_sessions s
    where s.id = p_session_id
      and s.pack_id = p_pack_id
      and s.user_id = v_user
      and s.mode = 'sort'
      and s.ended_at is null
  ) then
    raise exception 'Learning actions require the active Sort session';
  end if;

  select e.id into v_event_id
  from public.heuresis_card_events e
  where e.user_id = v_user
    and e.session_id = p_session_id
    and e.card_id = p_card_id
    and e.event_type = v_event_type
  limit 1;

  if v_event_id is not null then
    delete from public.heuresis_card_events where id = v_event_id;
    v_selected := false;
  else
    insert into public.heuresis_card_events
      (client_event_id, user_id, card_id, pack_id, session_id, template_id, event_type, created_at)
    values
      (gen_random_uuid(), v_user, p_card_id, p_pack_id, p_session_id, null, v_event_type, now());
    v_selected := true;
  end if;

  select count(*)::bigint into v_count
  from public.heuresis_card_events e
  where e.user_id = v_user
    and e.card_id = p_card_id
    and e.event_type = v_event_type;

  return jsonb_build_object(
    'selected', v_selected,
    'count', coalesce(v_count, 0),
    'action', p_action
  );
end
$$;

revoke execute on function public.heuresis_learning_counts(uuid[]) from public, anon;
grant execute on function public.heuresis_learning_counts(uuid[]) to authenticated;

revoke execute on function public.heuresis_toggle_learning_action(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.heuresis_toggle_learning_action(uuid,uuid,uuid,text) to authenticated;
