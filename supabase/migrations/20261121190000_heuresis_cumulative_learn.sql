-- Learn only: cumulative mastery, signed attempt points, and resumable five-exercise plans.
-- Completed legacy rounds retain history and existing readiness.
alter table public.heuresis_learn_rounds add column if not exists base_score integer;
alter table public.heuresis_learn_rounds drop constraint if exists heuresis_learn_rounds_score_check;
alter table public.heuresis_learn_rounds add constraint heuresis_learn_rounds_score_check check (score between 0 and 100);
alter table public.heuresis_learn_rounds drop constraint if exists heuresis_learn_rounds_ready_rule;
alter table public.heuresis_learn_rounds add constraint heuresis_learn_rounds_ready_rule check
  (not ready or (status = 'completed' and ((base_score is null and score >= 40 and recall_correct) or (base_score is not null and score = 100))));
alter table public.heuresis_learn_rounds add constraint heuresis_learn_rounds_base_score_range check (base_score between 0 and 100);
alter table public.heuresis_learn_attempts drop constraint if exists heuresis_learn_attempts_points_rule;
-- Historical wrong answers may have zero; new writes use -10, enforced in the owner-scoped RPC.
alter table public.heuresis_learn_attempts add constraint heuresis_learn_attempts_points_rule check
  (case when not correct then points in (-10, 0) when assisted then points = 0 else points = 10 end);

-- Bring unfinished legacy rounds onto the new score rule without changing completed history.
do $$
declare r record; a record; initial_score integer; running_score integer;
begin
  for r in select * from public.heuresis_learn_rounds where status = 'active' and base_score is null loop
    select coalesce((select q.score from public.heuresis_learn_rounds q where q.card_id = r.card_id and q.user_id = r.user_id
      and q.cycle = r.cycle and q.status = 'completed' and q.round_number < r.round_number order by q.round_number desc limit 1), 0) into initial_score;
    initial_score := least(50, initial_score);
    running_score := initial_score;
    for a in select * from public.heuresis_learn_attempts where round_id = r.id order by position loop
      running_score := greatest(0, least(100, running_score + case when not a.correct then -10 when a.assisted then 0 else 10 end));
      if not a.correct then update public.heuresis_learn_attempts set points = -10 where round_id = r.id and position = a.position; end if;
    end loop;
    update public.heuresis_learn_rounds set base_score = initial_score, score = running_score where id = r.id;
  end loop;
end $$;
alter table public.heuresis_learn_rounds alter column base_score set default 0;

create or replace function public.heuresis_learn_round_state(p_round_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'card_id', r.card_id,
    'pack_id', r.pack_id,
    'cycle', r.cycle,
    'round_number', r.round_number,
    'status', r.status,
    'score', r.score,
    'base_score', coalesce(r.base_score, 0),
    'correct_count', r.correct_count,
    'recall_correct', r.recall_correct,
    'ready', r.ready,
    'plan', r.plan,
    'started_at', r.started_at,
    'completed_at', r.completed_at,
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', a.position,
        'stage', a.stage,
        'exercise_type', a.exercise_type,
        'correct', a.correct,
        'assisted', a.assisted,
        'points', a.points,
        'response', a.response,
        'expected', a.expected,
        'corrected_at', a.corrected_at,
        'created_at', a.created_at
      ) order by a.position)
      from public.heuresis_learn_attempts a
      where a.round_id = r.id
    ), '[]'::jsonb)
  )
  from public.heuresis_learn_rounds r
  where r.id = p_round_id and r.user_id = (select auth.uid());
$$;

create or replace function public.heuresis_learn_begin_round(
  p_round_id uuid,
  p_card_id  uuid,
  p_cycle    integer,
  p_plan     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_pack   uuid;
  v_owner  uuid;
  v_active uuid;
  v_number integer;
  v_base integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_round_id is null or p_card_id is null then raise exception 'A round and a card are required'; end if;
  if p_cycle is null or p_cycle < 0 then raise exception 'Invalid Learning cycle'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) <> 5 then
    raise exception 'A Learning round has exactly five exercises';
  end if;

  -- Serialises two simultaneous starts for the same card.
  select c.pack_id into v_pack
    from public.heuresis_cards c
   where c.id = p_card_id and c.user_id = v_user and c.role = 'main'
   for update;
  if v_pack is null then raise exception 'Card unavailable'; end if;

  select r.user_id into v_owner from public.heuresis_learn_rounds r where r.id = p_round_id;
  if found then
    if v_owner <> v_user then raise exception 'Learning round unavailable'; end if;
    return public.heuresis_learn_round_state(p_round_id);
  end if;

  -- A round left unfinished before a Relearn belongs to an earlier cycle.
  update public.heuresis_learn_rounds r
     set status = 'abandoned', completed_at = now()
   where r.card_id = p_card_id and r.user_id = v_user
     and r.status = 'active' and r.cycle <> p_cycle;

  select r.id into v_active
    from public.heuresis_learn_rounds r
   where r.card_id = p_card_id and r.user_id = v_user and r.status = 'active';
  if v_active is not null then
    return public.heuresis_learn_round_state(v_active);
  end if;

  select coalesce(max(r.round_number), 0) + 1 into v_number
    from public.heuresis_learn_rounds r
   where r.card_id = p_card_id and r.cycle = p_cycle;

  select coalesce((select case when r.ready then 100 else r.score end
    from public.heuresis_learn_rounds r where r.card_id = p_card_id and r.user_id = v_user
      and r.cycle = p_cycle and r.status = 'completed' order by r.round_number desc limit 1), 0) into v_base;
  if v_base >= 100 then raise exception 'Card is already ready for Review'; end if;
  insert into public.heuresis_learn_rounds (id, user_id, card_id, pack_id, cycle, round_number, plan, base_score, score)
  values (p_round_id, v_user, p_card_id, v_pack, p_cycle, v_number, p_plan, v_base, v_base);

  return public.heuresis_learn_round_state(p_round_id);
end;
$$;

create or replace function public.heuresis_learn_record_attempt(
  p_round_id      uuid,
  p_position      integer,
  p_stage         text,
  p_exercise_type text,
  p_correct       boolean,
  p_assisted      boolean,
  p_response      text,
  p_expected      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_round    public.heuresis_learn_rounds%rowtype;
  v_answered integer;
  v_points   integer;
  v_score    integer;
  v_correct  integer;
  v_recall   boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_position is null or p_position < 1 or p_position > 5 then
    raise exception 'A Learning round has exactly five exercises';
  end if;
  if p_correct is null then raise exception 'An answer must be right or wrong'; end if;

  select * into v_round
    from public.heuresis_learn_rounds r
   where r.id = p_round_id and r.user_id = v_user
   for update;
  if not found then raise exception 'Learning round unavailable'; end if;

  -- Already answered (double click, refresh, replay) or the round is closed.
  if exists (select 1 from public.heuresis_learn_attempts a
              where a.round_id = p_round_id and a.position = p_position)
     or v_round.status <> 'active' then
    return public.heuresis_learn_round_state(p_round_id);
  end if;

  select count(*)::integer into v_answered
    from public.heuresis_learn_attempts a where a.round_id = p_round_id;
  if p_position <> v_answered + 1 then
    raise exception 'Exercise % cannot be recorded before exercise %', p_position, v_answered + 1;
  end if;

  v_points := case when not p_correct then -10 when coalesce(p_assisted, false) then 0 else 10 end;

  insert into public.heuresis_learn_attempts
    (round_id, position, user_id, card_id, pack_id, stage, exercise_type,
     correct, assisted, points, response, expected)
  values
    (p_round_id, p_position, v_user, v_round.card_id, v_round.pack_id, p_stage,
     left(coalesce(nullif(btrim(p_exercise_type), ''), 'exercise'), 40),
     p_correct, coalesce(p_assisted, false), v_points,
     left(coalesce(p_response, ''), 1000), left(coalesce(p_expected, ''), 1000));

  v_score := greatest(0, least(100, v_round.score + v_points));
  select count(*) filter (where a.points > 0)::integer into v_correct
    from public.heuresis_learn_attempts a where a.round_id = p_round_id;

  if p_position = 5 or v_score >= 100 then
    v_recall := p_position = 5 and p_correct and not coalesce(p_assisted, false);
    update public.heuresis_learn_rounds r
       set score = v_score, correct_count = v_correct, recall_correct = v_recall,
           ready = (v_score >= 100),
           status = 'completed', completed_at = now()
     where r.id = p_round_id;
  else
    update public.heuresis_learn_rounds r
       set score = v_score, correct_count = v_correct
     where r.id = p_round_id;
  end if;

  return public.heuresis_learn_round_state(p_round_id);
end;
$$;
