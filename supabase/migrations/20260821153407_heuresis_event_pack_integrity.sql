drop policy if exists heuresis_events_insert on public.heuresis_card_events;

create policy heuresis_events_insert
on public.heuresis_card_events
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.heuresis_cards c
    where c.id = heuresis_card_events.card_id
      and c.user_id = auth.uid()
      and c.pack_id = heuresis_card_events.pack_id
  )
  and exists (
    select 1
    from public.heuresis_sessions s
    where s.id = heuresis_card_events.session_id
      and s.user_id = auth.uid()
      and s.pack_id = heuresis_card_events.pack_id
  )
  and exists (
    select 1
    from public.heuresis_packs p
    where p.id = heuresis_card_events.pack_id
      and p.user_id = auth.uid()
  )
  and (
    template_id is null
    or exists (
      select 1
      from public.heuresis_study_templates st
      join public.heuresis_packs p on p.id = heuresis_card_events.pack_id
      where st.id = heuresis_card_events.template_id
        and st.card_type_id = p.card_type_id
        and (st.user_id is null or st.user_id = auth.uid())
    )
  )
);
