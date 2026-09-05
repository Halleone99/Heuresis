alter table public.heuresis_cards
  add column if not exists interest_rank smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'heuresis_cards_interest_rank_check'
      and conrelid = 'public.heuresis_cards'::regclass
  ) then
    alter table public.heuresis_cards
      add constraint heuresis_cards_interest_rank_check
      check (interest_rank is null or interest_rank between 1 and 5);
  end if;
end $$;

update public.heuresis_cards
set interest_rank = 4
where interesting = true and interest_rank is null;

alter table public.heuresis_tags
  add column if not exists is_badge boolean not null default false,
  add column if not exists shortcut text,
  add column if not exists sort_order integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'heuresis_tags_shortcut_check'
      and conrelid = 'public.heuresis_tags'::regclass
  ) then
    alter table public.heuresis_tags
      add constraint heuresis_tags_shortcut_check
      check (shortcut is null or shortcut ~ '^[a-z0-9][a-z0-9_-]{0,11}$');
  end if;
end $$;

create unique index if not exists heuresis_tags_user_shortcut_unique
  on public.heuresis_tags(user_id, lower(shortcut))
  where shortcut is not null;

alter table public.heuresis_sessions
  drop constraint if exists heuresis_sessions_mode_check;

alter table public.heuresis_sessions
  add constraint heuresis_sessions_mode_check
  check (mode in ('browse', 'flashcards', 'sort'));

create index if not exists heuresis_cards_user_interest_idx
  on public.heuresis_cards(user_id, interest_rank)
  where interest_rank is not null;

create index if not exists heuresis_tags_user_badge_sort_idx
  on public.heuresis_tags(user_id, is_badge, sort_order, name);
