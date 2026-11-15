-- Real, user-scoped 14-day Study home activity.
-- Dates are interpreted in the client's IANA time zone, including DST changes.
create or replace function public.heuresis_study_activity(
  p_pack_ids uuid[], p_from date, p_to date, p_tz text
)
returns table (
  day date, pack_id uuid, new_cards int, exercises int, reviews int
)
language sql stable security invoker
set search_path = public
as $$
  with selected_packs as (
    select distinct unnest(p_pack_ids) as id
  ),
  days as (
    select generate_series(p_from, p_to, interval '1 day')::date as local_day
    where p_to >= p_from and p_to - p_from <= 13
  ),
  reviewed as (
    select (e.created_at at time zone p_tz)::date as local_day,
           e.pack_id, count(distinct e.card_id)::int as count
    from public.heuresis_card_events e
    join selected_packs p on p.id = e.pack_id
    join public.heuresis_cards c on c.id = e.card_id
      and c.role = 'main' and c.retention = 'learning'
      and c.data ->> '_discarded_at' is null
    where e.event_type in ('again','hard','good','easy')
      and e.created_at >= (p_from::timestamp at time zone p_tz)
      and e.created_at < ((p_to + 1)::timestamp at time zone p_tz)
    group by 1, 2
  ),
  practiced as (
    select (a.created_at at time zone p_tz)::date as local_day,
           a.pack_id, count(*)::int as count
    from public.heuresis_learn_attempts a
    join selected_packs p on p.id = a.pack_id
    where a.created_at >= (p_from::timestamp at time zone p_tz)
      and a.created_at < ((p_to + 1)::timestamp at time zone p_tz)
    group by 1, 2
  ),
  started as (
    select ((c.data ->> '_sorted_at')::timestamptz at time zone p_tz)::date as local_day,
           c.pack_id, count(*)::int as count
    from public.heuresis_cards c
    join selected_packs p on p.id = c.pack_id
    where c.role = 'main' and c.retention = 'learning'
      and c.data ->> '_discarded_at' is null
      -- Sort writes valid ISO-8601 timestamps; ignore older/empty markers.
      and c.data ->> '_sorted_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    group by 1, 2
  )
  select d.local_day, p.id, coalesce(s.count, 0), coalesce(a.count, 0), coalesce(r.count, 0)
  from days d cross join selected_packs p
  left join started s on s.local_day = d.local_day and s.pack_id = p.id
  left join practiced a on a.local_day = d.local_day and a.pack_id = p.id
  left join reviewed r on r.local_day = d.local_day and r.pack_id = p.id
  order by d.local_day, p.id;
$$;
revoke all on function public.heuresis_study_activity(uuid[], date, date, text) from public, anon;
grant execute on function public.heuresis_study_activity(uuid[], date, date, text) to authenticated;
