-- Repeated flashcard mistakes are surfaced in Mistake Log from the second
-- Missed/Partial event onward. Existing historical mistakes are not backfilled.
-- All grades and optional explanations remain in their original append-only tables.

create table if not exists public.heuresis_review_mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.heuresis_cards(id) on delete cascade,
  pack_id uuid not null references public.heuresis_packs(id) on delete cascade,
  template_id uuid references public.heuresis_study_templates(id) on delete set null,
  miss_count integer not null check (miss_count >= 2),
  first_logged_at timestamptz not null default now(),
  last_wrong_at timestamptz not null default now(),
  constraint heuresis_review_mistakes_one_per_direction
    unique nulls not distinct (user_id, card_id, template_id)
);
create index if not exists heuresis_review_mistakes_recent
  on public.heuresis_review_mistakes (user_id, last_wrong_at desc);
alter table public.heuresis_review_mistakes enable row level security;
revoke all on public.heuresis_review_mistakes from public, anon, authenticated;
grant select on public.heuresis_review_mistakes to authenticated;
drop policy if exists heuresis_review_mistakes_select on public.heuresis_review_mistakes;
create policy heuresis_review_mistakes_select
on public.heuresis_review_mistakes for select to authenticated
using (user_id = (select auth.uid()));

-- A trigger rather than a client-side insert makes the threshold atomic,
-- including after offline grade queues are replayed and across devices.
create or replace function public.heuresis_capture_repeated_review_mistake()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare mistakes integer;
begin
  if new.event_type not in ('again', 'hard') then return new; end if;
  -- The invoking authenticated user must own the event.
  if new.user_id is distinct from (select auth.uid()) then return new; end if;
  select count(*)::integer into mistakes
    from public.heuresis_card_events e
    where e.user_id = new.user_id
      and e.card_id = new.card_id
      and e.template_id is not distinct from new.template_id
      and e.event_type in ('again', 'hard');
  if mistakes < 2 then return new; end if;

  insert into public.heuresis_review_mistakes
    (user_id, card_id, pack_id, template_id, miss_count, first_logged_at, last_wrong_at)
  values (new.user_id, new.card_id, new.pack_id, new.template_id, mistakes,
    now(), new.created_at)
  on conflict on constraint heuresis_review_mistakes_one_per_direction
  do update set
    miss_count = greatest(public.heuresis_review_mistakes.miss_count, excluded.miss_count),
    last_wrong_at = greatest(public.heuresis_review_mistakes.last_wrong_at, excluded.last_wrong_at);
  return new;
end;
$$;
revoke all on function public.heuresis_capture_repeated_review_mistake() from public, anon, authenticated;
drop trigger if exists heuresis_capture_repeated_review_mistake on public.heuresis_card_events;
create trigger heuresis_capture_repeated_review_mistake
  after insert on public.heuresis_card_events
  for each row execute function public.heuresis_capture_repeated_review_mistake();

-- Repair a pre-existing RLS policy bug: previously it compared c.pack_id
-- with c.pack_id, and s.pack_id with s.pack_id, rather than the correction.
drop policy if exists heuresis_review_corrections_insert on public.heuresis_review_corrections;
create policy heuresis_review_corrections_insert
on public.heuresis_review_corrections for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.heuresis_cards c
    where c.id = heuresis_review_corrections.card_id
      and c.pack_id = heuresis_review_corrections.pack_id
      and c.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.heuresis_sessions s
    where s.id = heuresis_review_corrections.session_id
      and s.pack_id = heuresis_review_corrections.pack_id
      and s.user_id = (select auth.uid())
  )
  and (
    template_id is null or exists (
      select 1 from public.heuresis_study_templates t
      join public.heuresis_packs p on p.card_type_id = t.card_type_id
      where t.id = heuresis_review_corrections.template_id
        and p.id = heuresis_review_corrections.pack_id
        and p.user_id = (select auth.uid())
        and (t.user_id is null or t.user_id = (select auth.uid()))
    )
  )
);
