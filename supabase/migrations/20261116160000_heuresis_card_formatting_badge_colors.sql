-- Card-formatting rules and optional badge colours. Review and Sort read the same rules.
alter table public.heuresis_tags add column if not exists color text;

create table if not exists public.heuresis_highlight_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lang text not null,
  text text not null check (char_length(text) between 1 and 80),
  style text not null check (style in ('mark', 'color', 'bold')),
  color text,
  whole_word boolean not null default false,
  card_id uuid references public.heuresis_cards(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists heuresis_highlight_rules_unique
on public.heuresis_highlight_rules (
  user_id, lang, lower(text), style,
  coalesce(card_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists heuresis_highlight_rules_user_lang
  on public.heuresis_highlight_rules (user_id, lang);

alter table public.heuresis_highlight_rules enable row level security;
revoke all on table public.heuresis_highlight_rules from public, anon;
grant select, insert, update, delete on table public.heuresis_highlight_rules to authenticated;

drop policy if exists heuresis_highlight_rules_select on public.heuresis_highlight_rules;
create policy heuresis_highlight_rules_select on public.heuresis_highlight_rules
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists heuresis_highlight_rules_insert on public.heuresis_highlight_rules;
create policy heuresis_highlight_rules_insert on public.heuresis_highlight_rules
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists heuresis_highlight_rules_update on public.heuresis_highlight_rules;
create policy heuresis_highlight_rules_update on public.heuresis_highlight_rules
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists heuresis_highlight_rules_delete on public.heuresis_highlight_rules;
create policy heuresis_highlight_rules_delete on public.heuresis_highlight_rules
  for delete to authenticated using (user_id = (select auth.uid()));
