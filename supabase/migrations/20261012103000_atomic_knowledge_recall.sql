-- Transactional, idempotent mistake recall. Existing practice rows are preserved.
-- The app supplies a stable event ID; retries never double-count it.
create or replace function public.heuresis_record_knowledge_recall(
  p_record_id uuid,
  p_event_id uuid,
  p_outcome text,
  p_answer text,
  p_tz_offset_minutes integer default 0
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_record public.knowledge_records%rowtype;
  v_event public.knowledge_practice_events%rowtype;
  v_now timestamptz := now();
  v_streak integer;
  v_due timestamptz;
  v_last timestamptz;
  v_same_day boolean;
  v_interval integer;
begin
  if v_user is null then raise exception 'Sign in to practise a mistake.' using errcode='42501'; end if;
  if p_event_id is null or p_record_id is null
     or p_outcome not in ('correct', 'incorrect')
     or p_answer is null or length(p_answer) > 5000
     or p_tz_offset_minutes not between -840 and 840 then
    raise exception 'Invalid mistake recall.' using errcode='22023';
  end if;
  select * into v_record from public.knowledge_records
    where id = p_record_id and user_id = v_user and kind = 'mistake'
    for update;
  if not found then raise exception 'Mistake not found.' using errcode='P0002'; end if;
  if length(btrim(v_record.correction)) = 0 then
    raise exception 'Add a correction before practising.' using errcode='22023';
  end if;
  select * into v_event from public.knowledge_practice_events
    where id = p_event_id and user_id = v_user;
  if found then
    if v_event.record_id <> p_record_id or v_event.outcome <> p_outcome then
      raise exception 'The event ID belongs to a different recall.' using errcode='23505';
    end if;
  else
    insert into public.knowledge_practice_events
      (id,user_id,record_id,outcome,answer,created_at)
    values (p_event_id,v_user,p_record_id,p_outcome,p_answer,v_now)
    returning * into v_event;
    if p_outcome = 'incorrect' then
      v_streak := 0;
      v_last := v_now;
      v_due := v_now + interval '1 day';
    else
      -- Convert timestamps to the user's local day using JS timezone offset.
      v_same_day := v_record.recall_streak > 0 and v_record.last_recalled_at is not null
        and (v_record.last_recalled_at - make_interval(mins => p_tz_offset_minutes))::date
        = (v_now - make_interval(mins => p_tz_offset_minutes))::date;
      v_streak := case when v_same_day then v_record.recall_streak else least(1000, v_record.recall_streak + 1) end;
      v_interval := case when v_streak = 1 then 1 when v_streak = 2 then 3
        when v_streak = 3 then 7 when v_streak = 4 then 21 else 60 end;
      v_last := case when v_same_day then v_record.last_recalled_at else v_now end;
      v_due := case when v_same_day and v_record.recall_due_at is not null
        then v_record.recall_due_at else v_now + make_interval(days => v_interval) end;
    end if;
    update public.knowledge_records
      set recall_streak = v_streak, last_recalled_at = v_last, recall_due_at = v_due
      where id = p_record_id and user_id = v_user
      returning * into v_record;
  end if;
  return jsonb_build_object(
    'id', v_event.id, 'user_id', v_event.user_id, 'record_id', v_event.record_id,
    'outcome', v_event.outcome, 'answer', v_event.answer, 'created_at', v_event.created_at,
    'recall_streak', v_record.recall_streak, 'last_recalled_at', v_record.last_recalled_at,
    'recall_due_at', v_record.recall_due_at);
end;
$$;
revoke all on function public.heuresis_record_knowledge_recall(uuid,uuid,text,text,integer) from public, anon;
grant execute on function public.heuresis_record_knowledge_recall(uuid,uuid,text,text,integer) to authenticated;
notify pgrst, 'reload schema';
