drop policy if exists heuresis_events_insert on public.heuresis_card_events;
create policy heuresis_events_insert
  on public.heuresis_card_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_cards c
      where c.id = card_id
        and c.user_id = (select auth.uid())
        and c.pack_id = pack_id
    )
    and exists (
      select 1 from public.heuresis_sessions s
      where s.id = session_id
        and s.user_id = (select auth.uid())
        and s.pack_id = pack_id
    )
    and exists (
      select 1 from public.heuresis_packs p
      where p.id = pack_id
        and p.user_id = (select auth.uid())
    )
    and (
      template_id is null
      or exists (
        select 1
        from public.heuresis_study_templates st
        join public.heuresis_packs p on p.id = pack_id
        where st.id = template_id
          and st.card_type_id = p.card_type_id
          and (st.user_id is null or st.user_id = (select auth.uid()))
      )
    )
  );

drop policy if exists heuresis_packs_insert on public.heuresis_packs;
create policy heuresis_packs_insert
  on public.heuresis_packs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_collections c
      where c.id = collection_id
        and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.heuresis_card_types ct
      where ct.id = card_type_id
        and (ct.user_id is null or ct.user_id = (select auth.uid()))
    )
    and (
      default_template_id is null
      or exists (
        select 1 from public.heuresis_study_templates st
        where st.id = default_template_id
          and st.card_type_id = card_type_id
          and (st.user_id is null or st.user_id = (select auth.uid()))
      )
    )
  );

drop policy if exists heuresis_packs_update on public.heuresis_packs;
create policy heuresis_packs_update
  on public.heuresis_packs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_collections c
      where c.id = collection_id
        and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.heuresis_card_types ct
      where ct.id = card_type_id
        and (ct.user_id is null or ct.user_id = (select auth.uid()))
    )
    and (
      default_template_id is null
      or exists (
        select 1 from public.heuresis_study_templates st
        where st.id = default_template_id
          and st.card_type_id = card_type_id
          and (st.user_id is null or st.user_id = (select auth.uid()))
      )
    )
  );

drop index if exists public.heuresis_events_client_event_uniq;
