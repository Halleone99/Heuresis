-- Compact access to the recent grade sequence needed by the client-side
-- reliability classifier. Keep the classifier itself in TypeScript: this RPC
-- only supplies evidence, so threshold changes do not require a database change.

create or replace function public.heuresis_recent_review_grades(
  p_card_ids uuid[],
  p_limit integer default 3
)
returns table(card_id uuid, grades text[])
language sql
stable
security invoker
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_card_ids, array[]::uuid[])) as card_id
  ), ranked as (
    select
      e.card_id,
      e.event_type as grade,
      e.created_at,
      e.id,
      row_number() over (
        partition by e.card_id
        order by e.created_at desc, e.id desc
      ) as recency
    from public.heuresis_card_events e
    join requested r on r.card_id = e.card_id
    where e.user_id = (select auth.uid())
      and e.event_type in ('again', 'hard', 'good', 'easy')
  )
  select
    ranked.card_id,
    array_agg(ranked.grade order by ranked.created_at, ranked.id)::text[] as grades
  from ranked
  where ranked.recency <= greatest(1, least(coalesce(p_limit, 3), 10))
  group by ranked.card_id;
$$;

comment on function public.heuresis_recent_review_grades(uuid[], integer) is
  'Returns each requested card''s most recent review grades, ordered oldest to newest. Evidence only; reliability thresholds live in learningSignals.ts.';

revoke all on function public.heuresis_recent_review_grades(uuid[], integer) from public, anon;
grant execute on function public.heuresis_recent_review_grades(uuid[], integer) to authenticated;
