-- Repair the existing correction ownership policy without changing stored notes.
-- Qualify the outer-table columns so the correlated subqueries cannot compare a column to itself.
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
