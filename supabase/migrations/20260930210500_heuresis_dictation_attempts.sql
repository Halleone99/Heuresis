create table public.heuresis_dictation_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id     uuid not null references public.heuresis_cards(id) on delete cascade,
  pack_id     uuid not null references public.heuresis_packs(id) on delete cascade,
  session_id  uuid references public.heuresis_sessions(id) on delete set null,
  template_id uuid references public.heuresis_study_templates(id) on delete set null,
  expected    text not null,
  attempt     text not null,
  verdict     text not null check (verdict in ('exact', 'close', 'different')),
  created_at  timestamptz not null default now()
);

create index heuresis_dictation_attempts_card_idx
  on public.heuresis_dictation_attempts (card_id, created_at desc);

alter table public.heuresis_dictation_attempts enable row level security;

create policy heuresis_dictation_attempts_select on public.heuresis_dictation_attempts
  for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_dictation_attempts_insert on public.heuresis_dictation_attempts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_dictation_attempts_delete on public.heuresis_dictation_attempts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.heuresis_dictation_attempts from anon;
grant select, insert, delete on table public.heuresis_dictation_attempts to authenticated;
