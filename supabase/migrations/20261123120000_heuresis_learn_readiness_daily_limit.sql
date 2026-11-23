-- Cumulative Learn: preserve scores, remove legacy 40/50-ready flags and persist daily limits.

update public.heuresis_learn_rounds set ready=(status='completed' and score>=100) where ready is distinct from (status='completed' and score>=100);

alter table public.heuresis_learn_rounds drop constraint if exists heuresis_learn_rounds_ready_rule;

alter table public.heuresis_learn_rounds add constraint heuresis_learn_rounds_ready_rule check(not ready or (status='completed' and score=100));

CREATE OR REPLACE FUNCTION public.heuresis_learn_round_state(p_round_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'ready', (r.status = 'completed' and r.score >= 100),
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
$function$;


CREATE OR REPLACE FUNCTION public.heuresis_learn_overview(p_card_ids uuid[], p_day_start timestamp with time zone, p_week_start timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scoped as (
    select r.*
      from public.heuresis_learn_rounds r
     where r.user_id = (select auth.uid())
       and r.card_id = any(coalesce(p_card_ids, '{}'::uuid[]))
       and r.status <> 'abandoned'
  ), latest as (
    select s.card_id, max(s.cycle) as cycle from scoped s group by s.card_id
  ), unfinished as (
    select s.card_id, jsonb_build_object(
      'id', s.id, 'round_number', s.round_number, 'score', s.score, 'started_at', s.started_at,
      'answered', (select count(*) from public.heuresis_learn_attempts a where a.round_id = s.id)
    ) as round
      from scoped s join latest l on l.card_id = s.card_id and l.cycle = s.cycle
     where s.status = 'active'
  ), finished as (
    select distinct on (s.card_id) s.card_id, jsonb_build_object(
      'id', s.id, 'round_number', s.round_number, 'score', s.score,
      'correct_count', s.correct_count, 'recall_correct', s.recall_correct,
      'ready', (s.status = 'completed' and s.score >= 100), 'completed_at', s.completed_at
    ) as round
      from scoped s join latest l on l.card_id = s.card_id and l.cycle = s.cycle
     where s.status = 'completed'
     order by s.card_id, s.round_number desc
  ), daily as (
    select l.card_id,
      coalesce(sum(a.points) filter (where a.created_at >= p_day_start and a.points > 0 and r.round_number > 1),0)::integer as daily_points,
      coalesce(bool_or(r.round_number = 1 and r.status = 'completed' and r.completed_at >= p_day_start),false) as first_completed_today
    from latest l join scoped r on r.card_id=l.card_id and r.cycle=l.cycle
    left join public.heuresis_learn_attempts a on a.round_id=r.id
    group by l.card_id
  ), activity as (
    select a.pack_id,
           count(*) as attempts_total,
           -- "Right first time" is what earned points: correct and unaided.
           count(*) filter (where a.points > 0) as correct_total,
           count(*) filter (where a.created_at >= p_day_start) as attempts_today,
           count(*) filter (where a.created_at >= p_week_start) as attempts_week,
           count(*) filter (where a.created_at >= p_week_start and a.points > 0) as correct_week
      from public.heuresis_learn_attempts a
     where a.user_id = (select auth.uid())
     group by a.pack_id
  )
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'card_id', l.card_id, 'cycle', l.cycle, 'active', u.round, 'last', f.round, 'daily_points', coalesce(d.daily_points,0), 'blocked_today', (coalesce(d.first_completed_today,false) or coalesce(d.daily_points,0) >= 20),
        'daily_points', public.heuresis_learn_daily_points(l.card_id, l.cycle),
        'blocked_today', not public.heuresis_learn_daily_allowed(l.card_id, l.cycle)))
        from latest l
        left join unfinished u on u.card_id = l.card_id
        left join finished f on f.card_id = l.card_id
        left join daily d on d.card_id = l.card_id
    ), '[]'::jsonb),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pack_id', x.pack_id, 'attempts_total', x.attempts_total, 'correct_total', x.correct_total,
        'attempts_today', x.attempts_today, 'attempts_week', x.attempts_week, 'correct_week', x.correct_week))
        from activity x
    ), '[]'::jsonb)
  );
$function$;


CREATE OR REPLACE FUNCTION public.heuresis_learn_begin_round_v2(p_round_id uuid, p_card_id uuid, p_cycle integer, p_plan jsonb, p_day_start timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_day_start is null or p_day_start > now() or p_day_start < now() - interval '26 hours' then
    raise exception 'Invalid local learning day';
  end if;
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

  select coalesce((select r.score
    from public.heuresis_learn_rounds r where r.card_id = p_card_id and r.user_id = v_user
      and r.cycle = p_cycle and r.status = 'completed' order by r.round_number desc limit 1), 0) into v_base;
  if v_base >= 100 then raise exception 'Card is already ready for Review'; end if;
  if v_number > 1 and (exists (select 1 from public.heuresis_learn_rounds r where r.user_id = v_user and r.card_id = p_card_id and r.cycle = p_cycle and r.round_number = 1 and r.status = 'completed' and r.completed_at >= p_day_start) or (select coalesce(sum(greatest(a.points,0)),0) from public.heuresis_learn_attempts a join public.heuresis_learn_rounds r on r.id=a.round_id where a.user_id=v_user and a.card_id=p_card_id and r.cycle=p_cycle and r.round_number>1 and a.created_at>=p_day_start) >= 20) then
    raise exception 'Learning allowance exhausted for today';
  end if;
  insert into public.heuresis_learn_rounds (id, user_id, card_id, pack_id, cycle, round_number, plan, base_score, score)
  values (p_round_id, v_user, p_card_id, v_pack, p_cycle, v_number, p_plan, v_base, v_base);

  return public.heuresis_learn_round_state(p_round_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.heuresis_learn_record_attempt_v2(p_round_id uuid, p_position integer, p_stage text, p_exercise_type text, p_correct boolean, p_assisted boolean, p_response text, p_expected text, p_day_start timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_day_start is null or p_day_start > now() or p_day_start < now() - interval '26 hours' then
    raise exception 'Invalid local learning day';
  end if;

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

  -- A stale or second-device attempt must not award extra points.
  if v_round.round_number > 1 and (exists (select 1 from public.heuresis_learn_rounds r where r.user_id = v_user and r.card_id = v_round.card_id and r.cycle = v_round.cycle and r.round_number = 1 and r.status = 'completed' and r.completed_at >= p_day_start) or (select coalesce(sum(greatest(a.points,0)),0) from public.heuresis_learn_attempts a join public.heuresis_learn_rounds r on r.id=a.round_id where a.user_id=v_user and a.card_id=v_round.card_id and r.cycle=v_round.cycle and r.round_number>1 and a.created_at>=p_day_start) >= 20) then
    return public.heuresis_learn_round_state(p_round_id);
  end if;
  select count(*)::integer into v_answered
    from public.heuresis_learn_attempts a where a.round_id = p_round_id;
  if p_position <> v_answered + 1 then
    raise exception 'Exercise % cannot be recorded before exercise %', p_position, v_answered + 1;
  end if;

  -- Same server-day allowance on every device, checked under the round lock.
  if v_round.round_number > 1 and not public.heuresis_learn_daily_allowed(v_round.card_id, v_round.cycle) then
    return public.heuresis_learn_round_state(p_round_id);
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
$function$;


create or replace function public.heuresis_learn_begin_round(p_round_id uuid,p_card_id uuid,p_cycle integer,p_plan jsonb) returns jsonb language sql security definer set search_path = '' as $$ select public.heuresis_learn_begin_round_v2(p_round_id,p_card_id,p_cycle,p_plan,date_trunc('day',now())); $$;

create or replace function public.heuresis_learn_record_attempt(p_round_id uuid,p_position integer,p_stage text,p_exercise_type text,p_correct boolean,p_assisted boolean,p_response text,p_expected text) returns jsonb language sql security definer set search_path = '' as $$ select public.heuresis_learn_record_attempt_v2(p_round_id,p_position,p_stage,p_exercise_type,p_correct,p_assisted,p_response,p_expected,date_trunc('day',now())); $$;

revoke all on function public.heuresis_learn_begin_round_v2(uuid,uuid,integer,jsonb,timestamptz) from public,anon;

grant execute on function public.heuresis_learn_begin_round_v2(uuid,uuid,integer,jsonb,timestamptz) to authenticated;

revoke all on function public.heuresis_learn_record_attempt_v2(uuid,integer,text,text,boolean,boolean,text,text,timestamptz) from public,anon;

grant execute on function public.heuresis_learn_record_attempt_v2(uuid,integer,text,text,boolean,boolean,text,text,timestamptz) to authenticated;
