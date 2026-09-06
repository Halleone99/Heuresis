create or replace function public.heuresis_toggle_learning_action(
  p_card_id uuid,
  p_pack_id uuid,
  p_session_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security invoker
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
      and s.mode in ('flashcards', 'related', 'sort')
      and s.ended_at is null
  ) then
    raise exception 'Learning actions require an active Heuresis study session';
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

revoke execute on function public.heuresis_toggle_learning_action(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.heuresis_toggle_learning_action(uuid,uuid,uuid,text) to authenticated;
