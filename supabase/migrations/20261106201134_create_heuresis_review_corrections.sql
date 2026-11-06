-- Preserve the learner's own explanation of a missed or partial review.
-- Unlike grades, corrections are prose attached to a particular card, direction
-- and session; they do not affect learning statistics.
create table if not exists public.heuresis_review_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null references public.heuresis_cards(id) on delete cascade,
  pack_id uuid not null references public.heuresis_packs(id) on delete cascade,
  session_id uuid references public.heuresis_sessions(id) on delete set null,
  template_id uuid references public.heuresis_study_templates(id) on delete set null,
  grade text not null check (grade in ('again', 'hard')),
  attempt text not null check (char_length(attempt) <= 3000),
  reference_answer text not null check (char_length(btrim(reference_answer)) between 1 and 3000),
  explanation text not null check (char_length(btrim(explanation)) between 1 and 3000),
  created_at timestamptz not null default now()
);

comment on table public.heuresis_review_corrections is
  'Append-only notes made during a Missed/Partial Heuresis review. A grade can exist without a note.';

create index if not exists heuresis_review_corrections_card_idx
  on public.heuresis_review_corrections (user_id, card_id, template_id, created_at desc);
create index if not exists heuresis_review_corrections_history_idx
  on public.heuresis_review_corrections (user_id, created_at desc);

alter table public.heuresis_review_corrections enable row level security;
create policy heuresis_review_corrections_select
on public.heuresis_review_corrections for select to authenticated
using (user_id = (select auth.uid()));

create policy heuresis_review_corrections_insert
on public.heuresis_review_corrections for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.heuresis_cards c
    where c.id = card_id and c.pack_id = pack_id and c.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.heuresis_sessions s
    where s.id = session_id and s.pack_id = pack_id and s.user_id = (select auth.uid())
  )
  and (
    template_id is null or exists (
      select 1 from public.heuresis_study_templates t
      join public.heuresis_packs p on p.card_type_id = t.card_type_id
      where t.id = template_id and p.id = pack_id
        and p.user_id = (select auth.uid())
        and (t.user_id is null or t.user_id = (select auth.uid()))
    )
  )
);

revoke all on public.heuresis_review_corrections from public, anon;
grant select, insert on public.heuresis_review_corrections to authenticated;
