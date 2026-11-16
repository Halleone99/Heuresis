-- Cumulative Learning mastery: two or more five-exercise rounds per card.
-- Preserves every historical attempt, score, card id and review event.
-- Run AFTER 20261110120000_heuresis_learn_rounds.sql.
-- The client requires 100 cumulative points AND unaided final recall.

alter table public.heuresis_learn_rounds
  drop constraint if exists heuresis_learn_rounds_ready_rule;
alter table public.heuresis_learn_rounds
  add constraint heuresis_learn_rounds_ready_rule
  check (not ready or (status = 'completed' and recall_correct));

-- Recompute legacy ready flags without changing previously earned points.
-- Existing cards already in Review are not moved back.
with cumulative as (
  select r.id, sum(r.score) over (
    partition by r.user_id, r.card_id, r.cycle
    order by r.round_number rows between unbounded preceding and current row
  )::integer as total_points
  from public.heuresis_learn_rounds r
  where r.status = 'completed'
)
update public.heuresis_learn_rounds r
   set ready = (c.total_points >= 100 and r.recall_correct)
  from cumulative c
 where r.id = c.id
   and r.ready is distinct from (c.total_points >= 100 and r.recall_correct);

-- The database, not the browser, remains authoritative for scoring and readiness.
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
  v_total    integer;
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

  v_points := case when p_correct and not coalesce(p_assisted, false) then 10 else 0 end;

  insert into public.heuresis_learn_attempts
    (round_id, position, user_id, card_id, pack_id, stage, exercise_type,
     correct, assisted, points, response, expected)
  values
    (p_round_id, p_position, v_user, v_round.card_id, v_round.pack_id, p_stage,
     left(coalesce(nullif(btrim(p_exercise_type), ''), 'exercise'), 40),
     p_correct, coalesce(p_assisted, false), v_points,
     left(coalesce(p_response, ''), 1000), left(coalesce(p_expected, ''), 1000));

  select coalesce(sum(a.points), 0)::integer, count(*) filter (where a.points > 0)::integer
    into v_score, v_correct
    from public.heuresis_learn_attempts a where a.round_id = p_round_id;

  -- Earlier completed rounds in this card's current Learning cycle retain their points.
  -- The active round's points are added only once, on its first recorded answers.
  select coalesce(sum(r.score), 0)::integer into v_total
    from public.heuresis_learn_rounds r
   where r.user_id = v_user and r.card_id = v_round.card_id
     and r.cycle = v_round.cycle and r.status = 'completed';
  v_total := v_total + v_score;

  if p_position = 5 then
    v_recall := p_correct and not coalesce(p_assisted, false);
    update public.heuresis_learn_rounds r
       set score = v_score, correct_count = v_correct, recall_correct = v_recall,
           ready = (v_total >= 100 and v_recall),
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

-- Expose aggregate completed-round points for consistent UI/resume across devices.
create or replace function public.heuresis_learn_overview(
  p_card_ids   uuid[],
  p_day_start  timestamptz,
  p_week_start timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scoped as (
    select r.*
      from public.heuresis_learn_rounds r
     where r.user_id = (select auth.uid())
       and r.card_id = any(coalesce(p_card_ids, '{}'::uuid[]))
       and r.status <> 'abandoned'
  ), latest as (
    select s.card_id, max(s.cycle) as cycle from scoped s group by s.card_id
  ), totals as (
    select s.card_id, s.cycle, sum(s.score)::integer as total_points
      from scoped s where s.status = 'completed'
     group by s.card_id, s.cycle
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
      'ready', s.ready, 'completed_at', s.completed_at
    ) as round
      from scoped s join latest l on l.card_id = s.card_id and l.cycle = s.cycle
     where s.status = 'completed'
     order by s.card_id, s.round_number desc
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
        'card_id', l.card_id, 'cycle', l.cycle, 'total_points', coalesce(t.total_points, 0), 'active', u.round, 'last', f.round))
        from latest l
        left join unfinished u on u.card_id = l.card_id
        left join finished f on f.card_id = l.card_id
        left join totals t on t.card_id = l.card_id and t.cycle = l.cycle
    ), '[]'::jsonb),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pack_id', x.pack_id, 'attempts_total', x.attempts_total, 'correct_total', x.correct_total,
        'attempts_today', x.attempts_today, 'attempts_week', x.attempts_week, 'correct_week', x.correct_week))
        from activity x
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.heuresis_learn_record_attempt(uuid, integer, text, text, boolean, boolean, text, text) from public, anon;
revoke all on function public.heuresis_learn_overview(uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.heuresis_learn_record_attempt(uuid, integer, text, text, boolean, boolean, text, text) to authenticated;
grant execute on function public.heuresis_learn_overview(uuid[], timestamptz, timestamptz) to authenticated;
