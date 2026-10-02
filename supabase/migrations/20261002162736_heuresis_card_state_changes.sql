-- Heuresis: the missing history behind Learning <-> Reference.
--
-- heuresis_card_stats is a pure fold over heuresis_card_events, so every grade,
-- encounter, reveal and learning action can be replayed to reconstruct a card's
-- state at any past date. retention, role and sort completion are plain columns
-- written by UPDATE, so their history does not exist anywhere and cannot be
-- recovered later. This table records those transitions as they happen.
--
-- Events were not reused for this: heuresis_card_events.session_id is NOT NULL,
-- and retention changes happen outside any session (read mode, the catalogue).

create table if not exists public.heuresis_card_state_changes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  card_id    uuid not null references public.heuresis_cards(id) on delete cascade,
  pack_id    uuid not null references public.heuresis_packs(id) on delete cascade,
  state_kind text not null check (state_kind in ('retention', 'role', 'sorted')),
  from_state text,
  to_state   text not null,
  origin     text not null default 'observed' check (origin in ('observed', 'backfill')),
  changed_at timestamptz not null default now()
);

comment on table public.heuresis_card_state_changes is
  'Append-only log of card state transitions that are not derivable from heuresis_card_events.';
comment on column public.heuresis_card_state_changes.origin is
  'observed = recorded as it happened. backfill = asserted from the card''s state when this table was created, so it is a lower bound on truth: any transition before that point is unknowable. Exclude or discount backfill rows in analysis.';
comment on column public.heuresis_card_state_changes.to_state is
  'For state_kind = sorted this holds the _sorted_at value the client wrote, as text; changed_at is when the change was observed.';

create index if not exists heuresis_card_state_changes_card_idx
  on public.heuresis_card_state_changes (card_id, changed_at);

create index if not exists heuresis_card_state_changes_scan_idx
  on public.heuresis_card_state_changes (user_id, state_kind, changed_at desc);

create index if not exists heuresis_card_state_changes_pack_idx
  on public.heuresis_card_state_changes (pack_id, state_kind, changed_at);

-- One trigger on the table catches every path: heuresis_set_card_retention, the
-- heuresis_sync_card_retention BEFORE trigger (related -> reference, promotion ->
-- learning), role promotion, bulk import, and any future direct UPDATE. Logging
-- inside the RPC alone would miss all of the implicit ones.
create or replace function public.heuresis_log_card_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_sorted text;
  v_new_sorted text;
begin
  if tg_op = 'INSERT' then
    -- changed_at records when the database observed the state. Do not borrow
    -- created_at here: imports may preserve an older source creation date.
    insert into public.heuresis_card_state_changes
      (user_id, card_id, pack_id, state_kind, from_state, to_state, changed_at)
    values
      (new.user_id, new.id, new.pack_id, 'retention', null, new.retention, now()),
      (new.user_id, new.id, new.pack_id, 'role', null, new.role, now());

    v_new_sorted := new.data ->> '_sorted_at';
    if v_new_sorted is not null then
      insert into public.heuresis_card_state_changes
        (user_id, card_id, pack_id, state_kind, from_state, to_state, changed_at)
      values
        (new.user_id, new.id, new.pack_id, 'sorted', null, v_new_sorted, now());
    end if;

    return new;
  end if;

  if new.retention is distinct from old.retention then
    insert into public.heuresis_card_state_changes
      (user_id, card_id, pack_id, state_kind, from_state, to_state)
    values
      (new.user_id, new.id, new.pack_id, 'retention', old.retention, new.retention);
  end if;

  if new.role is distinct from old.role then
    insert into public.heuresis_card_state_changes
      (user_id, card_id, pack_id, state_kind, from_state, to_state)
    values
      (new.user_id, new.id, new.pack_id, 'role', old.role, new.role);
  end if;

  -- Sort completion lives in card data as _sorted_at, written through
  -- heuresis_patch_card_data. Stored as text rather than cast to timestamptz:
  -- the value is client-supplied and a bad cast would abort the card write.
  v_old_sorted := old.data ->> '_sorted_at';
  v_new_sorted := new.data ->> '_sorted_at';
  if v_new_sorted is not null and v_new_sorted is distinct from v_old_sorted then
    insert into public.heuresis_card_state_changes
      (user_id, card_id, pack_id, state_kind, from_state, to_state)
    values
      (new.user_id, new.id, new.pack_id, 'sorted', v_old_sorted, v_new_sorted);
  end if;

  return new;
end
$$;

revoke all on function public.heuresis_log_card_state_change() from public, anon, authenticated;

drop trigger if exists heuresis_log_card_state_change on public.heuresis_cards;
create trigger heuresis_log_card_state_change
after insert or update of retention, role, data on public.heuresis_cards
for each row execute function public.heuresis_log_card_state_change();

-- Baseline rows for cards that already exist, so forward replay has a starting
-- point. These are asserted, not observed: changed_at is migration time, meaning
-- "this was the state when instrumentation began". We deliberately do not use
-- card.created_at, because that would invent historical state we never observed.
insert into public.heuresis_card_state_changes
  (user_id, card_id, pack_id, state_kind, from_state, to_state, origin, changed_at)
select c.user_id, c.id, c.pack_id, 'retention', null, c.retention, 'backfill', now()
from public.heuresis_cards c
where not exists (
  select 1 from public.heuresis_card_state_changes s
  where s.card_id = c.id and s.state_kind = 'retention'
);

insert into public.heuresis_card_state_changes
  (user_id, card_id, pack_id, state_kind, from_state, to_state, origin, changed_at)
select c.user_id, c.id, c.pack_id, 'role', null, c.role, 'backfill', now()
from public.heuresis_cards c
where not exists (
  select 1 from public.heuresis_card_state_changes s
  where s.card_id = c.id and s.state_kind = 'role'
);

insert into public.heuresis_card_state_changes
  (user_id, card_id, pack_id, state_kind, from_state, to_state, origin, changed_at)
select c.user_id, c.id, c.pack_id, 'sorted', null, c.data ->> '_sorted_at', 'backfill', now()
from public.heuresis_cards c
where c.data ->> '_sorted_at' is not null
  and not exists (
    select 1 from public.heuresis_card_state_changes s
    where s.card_id = c.id and s.state_kind = 'sorted'
  );

alter table public.heuresis_card_state_changes enable row level security;

-- Read-only to the client. Only the security-definer trigger writes, so the
-- history cannot be fabricated, edited or pruned from the app; rows leave only
-- when their card is deleted.
drop policy if exists heuresis_card_state_changes_select on public.heuresis_card_state_changes;
create policy heuresis_card_state_changes_select
on public.heuresis_card_state_changes
for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.heuresis_card_state_changes from anon;
grant select on table public.heuresis_card_state_changes to authenticated;
