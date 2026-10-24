-- Restore strict cross-table checks for review events and idempotent replay.
-- IMPORTANT: Run in a staging database first. This migration never deletes history.
-- The September policy used unqualified column names inside subqueries, allowing
-- those names to bind to the inner row rather than the event being inserted.

do $$
declare
  duplicate_events bigint;
begin
  select count(*) into duplicate_events
  from (
    select user_id, client_event_id
    from public.heuresis_card_events
    where client_event_id is not null
    group by user_id, client_event_id
    having count(*) > 1
  ) repeated;
  if duplicate_events > 0 then
    raise exception 'Found % duplicated client event IDs. Back up and reconcile affected review history before adding the uniqueness safeguard.', duplicate_events;
  end if;
end $$;

-- Without this index, RPC retries after uncertain network failures can insert
-- a review event twice. Do not remove duplicates automatically: event triggers
-- have already updated aggregate statistics for each recorded row.
create unique index if not exists heuresis_events_client_event_uniq
  on public.heuresis_card_events (user_id, client_event_id);

drop policy if exists heuresis_events_insert on public.heuresis_card_events;
create policy heuresis_events_insert
  on public.heuresis_card_events
  for insert to authenticated
  with check (
    heuresis_card_events.user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_cards as c
      where c.id = heuresis_card_events.card_id
        and c.user_id = (select auth.uid())
        and c.pack_id = heuresis_card_events.pack_id
    )
    and exists (
      select 1 from public.heuresis_sessions as s
      where s.id = heuresis_card_events.session_id
        and s.user_id = (select auth.uid())
        and s.pack_id = heuresis_card_events.pack_id
    )
    and exists (
      select 1 from public.heuresis_packs as p
      where p.id = heuresis_card_events.pack_id
        and p.user_id = (select auth.uid())
    )
    and (
      heuresis_card_events.template_id is null
      or exists (
        select 1 from public.heuresis_study_templates as st
        join public.heuresis_packs as p
          on p.id = heuresis_card_events.pack_id
        where st.id = heuresis_card_events.template_id
          and st.card_type_id = p.card_type_id
          and (st.user_id is null or st.user_id = (select auth.uid()))
      )
    )
  );

-- Historical mismatches are not repaired here: doing so blindly could alter
-- sessions, counters and evidence. Inspect the counts before any remediation.
do $$
declare
  mismatches bigint;
begin
  select count(*) into mismatches
  from public.heuresis_card_events as e
  left join public.heuresis_cards as c on c.id = e.card_id
  left join public.heuresis_sessions as s on s.id = e.session_id
  where c.pack_id is distinct from e.pack_id
     or s.pack_id is distinct from e.pack_id;
  if mismatches > 0 then
    raise warning 'Heuresis has % historically mismatched review events. Inspect them before repairing historical statistics.', mismatches;
  end if;
end $$;
