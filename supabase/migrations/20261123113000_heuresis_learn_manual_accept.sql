-- A learner may overrule a false negative immediately after a scored Learning answer.
-- Retain the original response and audit that the automatic verdict was overridden.
-- This does not create a second attempt, change Review, or bypass the mixed-learning daily limit.
alter table public.heuresis_learn_attempts
  add column if not exists manually_accepted_at timestamptz;

create or replace function public.heuresis_learn_accept_answer(
  p_round_id uuid,
  p_position integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_round public.heuresis_learn_rounds%rowtype;
  v_attempt public.heuresis_learn_attempts%rowtype;
  v_row record;
  v_score integer;
  v_correct integer;
  v_last integer;
  v_recall boolean;
  v_completed boolean;
  v_day_start timestamptz;
  v_daily integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_position is null or p_position not between 1 and 5 then raise exception 'Invalid exercise'; end if;

  select * into v_round
    from public.heuresis_learn_rounds r
    where r.id = p_round_id and r.user_id = v_user for update;
  if not found or v_round.status = 'abandoned' then raise exception 'Learning round unavailable'; end if;

  select * into v_attempt from public.heuresis_learn_attempts a
    where a.round_id = p_round_id and a.position = p_position and a.user_id = v_user
    for update;
  if not found then raise exception 'Answer unavailable'; end if;
  -- Repeated requests are idempotent and cannot grant points twice.
  if v_attempt.correct then return public.heuresis_learn_round_state(p_round_id); end if;
  if exists (select 1 from public.heuresis_learn_attempts a
             where a.round_id = p_round_id and a.position > p_position)
    or exists (select 1 from public.heuresis_learn_rounds r
               where r.card_id = v_round.card_id and r.cycle = v_round.cycle
                 and r.round_number > v_round.round_number and r.status <> 'abandoned') then
    raise exception 'Only the most recent Learning answer may be corrected';
  end if;

  -- A correction takes the same daily allowance as any unaided correct answer.
  if v_round.round_number > 1 and not v_attempt.assisted then
    v_day_start := date_trunc('day', v_attempt.created_at at time zone 'UTC') at time zone 'UTC';
    select coalesce(sum(a.points), 0)::integer into v_daily
      from public.heuresis_learn_attempts a
      join public.heuresis_learn_rounds r on r.id = a.round_id
      where a.user_id = v_user and r.user_id = v_user and r.card_id = v_round.card_id
        and r.cycle = v_round.cycle and r.round_number > 1 and a.points > 0
        and a.created_at >= v_day_start and a.created_at < v_day_start + interval '1 day';
    if v_daily + 10 > 20 then raise exception 'Daily learning allowance reached'; end if;
  end if;

  update public.heuresis_learn_attempts a
    set correct = true, points = case when a.assisted then 0 else 10 end,
        manually_accepted_at = coalesce(a.manually_accepted_at, now())
    where a.round_id = p_round_id and a.position = p_position and a.user_id = v_user;

  -- Replay each attempt in order: subtracting -10 from a clipped score is incorrect at zero.
  v_score := greatest(0, least(100, coalesce(v_round.base_score, 0)));
  for v_row in select a.points from public.heuresis_learn_attempts a
               where a.round_id = p_round_id order by a.position loop
    v_score := greatest(0, least(100, v_score + v_row.points));
  end loop;
  select count(*) filter (where a.points > 0)::integer, max(a.position)::integer,
         bool_or(a.position = 5 and a.correct and not a.assisted)
    into v_correct, v_last, v_recall
    from public.heuresis_learn_attempts a where a.round_id = p_round_id;
  v_completed := v_round.status = 'completed' or v_last = 5 or v_score >= 100;
  update public.heuresis_learn_rounds r
    set score = v_score, correct_count = v_correct, recall_correct = coalesce(v_recall, false),
        ready = (v_score >= 100), status = case when v_completed then 'completed' else 'active' end,
        completed_at = case when v_completed then coalesce(v_round.completed_at, now()) else null end
    where r.id = p_round_id and r.user_id = v_user;

  return public.heuresis_learn_round_state(p_round_id);
end;
$$;

revoke all on function public.heuresis_learn_accept_answer(uuid, integer) from public, anon;
grant execute on function public.heuresis_learn_accept_answer(uuid, integer) to authenticated;
