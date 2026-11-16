-- Resolve repeated Study mistakes once the same direction is answered correctly.
-- All histories remain append-only; the summary row remains available for future misses.
alter table public.heuresis_review_mistakes
  add column if not exists resolved_at timestamptz;

create index if not exists heuresis_review_mistakes_open
  on public.heuresis_review_mistakes (user_id, last_wrong_at desc)
  where resolved_at is null;

create or replace function public.heuresis_capture_repeated_review_mistake()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare mistakes integer;
begin
  if new.event_type not in ('again', 'hard', 'good', 'easy') then return new; end if;
  -- Preserve the authenticated owner check from the original trigger.
  if new.user_id is distinct from (select auth.uid()) then return new; end if;

  if new.event_type in ('good', 'easy') then
    update public.heuresis_review_mistakes m
       set resolved_at = new.created_at
     where m.user_id = new.user_id
       and m.card_id = new.card_id
       and m.template_id is not distinct from new.template_id
       and new.created_at > m.last_wrong_at
       and (m.resolved_at is null or new.created_at > m.resolved_at);
    return new;
  end if;

  select count(*)::integer into mistakes
    from public.heuresis_card_events e
   where e.user_id = new.user_id
     and e.card_id = new.card_id
     and e.template_id is not distinct from new.template_id
     and e.event_type in ('again', 'hard');
  if mistakes < 2 then return new; end if;

  insert into public.heuresis_review_mistakes
    (user_id, card_id, pack_id, template_id, miss_count, first_logged_at, last_wrong_at)
  values (new.user_id, new.card_id, new.pack_id, new.template_id, mistakes, now(), new.created_at)
  on conflict on constraint heuresis_review_mistakes_one_per_direction
  do update set
    miss_count = greatest(public.heuresis_review_mistakes.miss_count, excluded.miss_count),
    last_wrong_at = greatest(public.heuresis_review_mistakes.last_wrong_at, excluded.last_wrong_at),
    resolved_at = case
      when excluded.last_wrong_at > coalesce(public.heuresis_review_mistakes.resolved_at, '-infinity'::timestamptz)
        then null
      else public.heuresis_review_mistakes.resolved_at
    end;
  return new;
end;
$$;
revoke all on function public.heuresis_capture_repeated_review_mistake() from public, anon, authenticated;

-- Existing summaries may already have a later correct grade. Backfill by
-- latest event for the exact card and direction, never by an unrelated template.
with last_grade as (
  select distinct on (m.id)
    m.id as mistake_id, e.event_type, e.created_at, m.last_wrong_at
  from public.heuresis_review_mistakes m
  join public.heuresis_card_events e
    on e.user_id = m.user_id and e.card_id = m.card_id
   and e.template_id is not distinct from m.template_id
   and e.event_type in ('again', 'hard', 'good', 'easy')
  order by m.id, e.created_at desc, e.id desc
)
update public.heuresis_review_mistakes m
   set resolved_at = g.created_at
  from last_grade g
 where m.id = g.mistake_id
   and g.event_type in ('good', 'easy') and g.created_at > g.last_wrong_at;
