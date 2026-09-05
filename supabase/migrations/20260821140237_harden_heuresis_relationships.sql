-- Harden Heuresis event idempotency and cross-table ownership checks.
-- Safe after the initial Heuresis migration and idempotent on production.

alter table public.heuresis_card_events
  add column if not exists client_event_id uuid;

update public.heuresis_card_events
set client_event_id = gen_random_uuid()
where client_event_id is null;

alter table public.heuresis_card_events
  alter column client_event_id set not null;

create unique index if not exists heuresis_events_client_event_uniq
  on public.heuresis_card_events (user_id, client_event_id);

create or replace function public.heuresis_record_events(events jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if jsonb_typeof(events) is distinct from 'array' then
    raise exception 'heuresis_record_events expects a jsonb array';
  end if;

  insert into heuresis_card_events
    (client_event_id, card_id, pack_id, session_id, template_id, event_type, created_at)
  select (e ->> 'client_event_id')::uuid,
         (e ->> 'card_id')::uuid,
         (e ->> 'pack_id')::uuid,
         (e ->> 'session_id')::uuid,
         nullif(e ->> 'template_id', '')::uuid,
         e ->> 'event_type',
         coalesce((e ->> 'created_at')::timestamptz, now())
  from jsonb_array_elements(events) as e
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end
$$;

drop policy if exists heuresis_collections_select on public.heuresis_collections;
drop policy if exists heuresis_collections_insert on public.heuresis_collections;
drop policy if exists heuresis_collections_update on public.heuresis_collections;
drop policy if exists heuresis_collections_delete on public.heuresis_collections;
create policy heuresis_collections_select on public.heuresis_collections for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_collections_insert on public.heuresis_collections for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_collections_update on public.heuresis_collections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy heuresis_collections_delete on public.heuresis_collections for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists heuresis_packs_select on public.heuresis_packs;
drop policy if exists heuresis_packs_insert on public.heuresis_packs;
drop policy if exists heuresis_packs_update on public.heuresis_packs;
drop policy if exists heuresis_packs_delete on public.heuresis_packs;
create policy heuresis_packs_select on public.heuresis_packs for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_packs_insert on public.heuresis_packs for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_collections c where c.id = collection_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid())))
  and (default_template_id is null or exists (
    select 1 from public.heuresis_study_templates st
    where st.id = default_template_id and st.card_type_id = card_type_id
      and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);
create policy heuresis_packs_update on public.heuresis_packs for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_collections c where c.id = collection_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid())))
  and (default_template_id is null or exists (
    select 1 from public.heuresis_study_templates st
    where st.id = default_template_id and st.card_type_id = card_type_id
      and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);
create policy heuresis_packs_delete on public.heuresis_packs for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists heuresis_cards_select on public.heuresis_cards;
drop policy if exists heuresis_cards_insert on public.heuresis_cards;
drop policy if exists heuresis_cards_update on public.heuresis_cards;
drop policy if exists heuresis_cards_delete on public.heuresis_cards;
create policy heuresis_cards_select on public.heuresis_cards for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_cards_insert on public.heuresis_cards for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
);
create policy heuresis_cards_update on public.heuresis_cards for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
);
create policy heuresis_cards_delete on public.heuresis_cards for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists heuresis_card_tags_select on public.heuresis_card_tags;
drop policy if exists heuresis_card_tags_insert on public.heuresis_card_tags;
drop policy if exists heuresis_card_tags_delete on public.heuresis_card_tags;
create policy heuresis_card_tags_select on public.heuresis_card_tags for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_card_tags_insert on public.heuresis_card_tags for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_cards c where c.id = card_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_tags t where t.id = tag_id and t.user_id = (select auth.uid()))
);
create policy heuresis_card_tags_delete on public.heuresis_card_tags for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists heuresis_sessions_select on public.heuresis_sessions;
drop policy if exists heuresis_sessions_insert on public.heuresis_sessions;
drop policy if exists heuresis_sessions_update on public.heuresis_sessions;
create policy heuresis_sessions_select on public.heuresis_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_sessions_insert on public.heuresis_sessions for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
  and (template_id is null or exists (
    select 1 from public.heuresis_study_templates st
    join public.heuresis_packs p on p.id = pack_id
    where st.id = template_id and st.card_type_id = p.card_type_id
      and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);
create policy heuresis_sessions_update on public.heuresis_sessions for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
);

drop policy if exists heuresis_events_select on public.heuresis_card_events;
drop policy if exists heuresis_events_insert on public.heuresis_card_events;
create policy heuresis_events_select on public.heuresis_card_events for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_events_insert on public.heuresis_card_events for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_cards c where c.id = card_id and c.user_id = (select auth.uid()) and c.pack_id = pack_id)
  and exists (select 1 from public.heuresis_sessions s where s.id = session_id and s.user_id = (select auth.uid()) and s.pack_id = pack_id)
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
  and (template_id is null or exists (
    select 1 from public.heuresis_study_templates st
    join public.heuresis_packs p on p.id = pack_id
    where st.id = template_id and st.card_type_id = p.card_type_id
      and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);

drop policy if exists heuresis_card_types_select on public.heuresis_card_types;
drop policy if exists heuresis_card_types_insert on public.heuresis_card_types;
drop policy if exists heuresis_card_types_update on public.heuresis_card_types;
drop policy if exists heuresis_card_types_delete on public.heuresis_card_types;
create policy heuresis_card_types_select on public.heuresis_card_types for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy heuresis_card_types_insert on public.heuresis_card_types for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_card_types_update on public.heuresis_card_types for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy heuresis_card_types_delete on public.heuresis_card_types for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists heuresis_templates_select on public.heuresis_study_templates;
drop policy if exists heuresis_templates_insert on public.heuresis_study_templates;
drop policy if exists heuresis_templates_update on public.heuresis_study_templates;
drop policy if exists heuresis_templates_delete on public.heuresis_study_templates;
create policy heuresis_templates_select on public.heuresis_study_templates for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy heuresis_templates_insert on public.heuresis_study_templates for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid()))
  )
);
create policy heuresis_templates_update on public.heuresis_study_templates for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid()))
  )
);
create policy heuresis_templates_delete on public.heuresis_study_templates for delete to authenticated using (user_id = (select auth.uid()));

revoke all privileges on table public.heuresis_collections from anon;
revoke all privileges on table public.heuresis_card_types from anon;
revoke all privileges on table public.heuresis_study_templates from anon;
revoke all privileges on table public.heuresis_packs from anon;
revoke all privileges on table public.heuresis_cards from anon;
revoke all privileges on table public.heuresis_tags from anon;
revoke all privileges on table public.heuresis_card_tags from anon;
revoke all privileges on table public.heuresis_sessions from anon;
revoke all privileges on table public.heuresis_card_events from anon;
revoke all privileges on table public.heuresis_card_stats from anon;
revoke all privileges on table public.heuresis_pack_stats from anon;
revoke all privileges on table public.heuresis_pack_overview from anon;

grant select, insert, update, delete on table public.heuresis_collections to authenticated;
grant select, insert, update, delete on table public.heuresis_card_types to authenticated;
grant select, insert, update, delete on table public.heuresis_study_templates to authenticated;
grant select, insert, update, delete on table public.heuresis_packs to authenticated;
grant select, insert, update, delete on table public.heuresis_cards to authenticated;
grant select, insert, update, delete on table public.heuresis_tags to authenticated;
grant select, insert, delete on table public.heuresis_card_tags to authenticated;
grant select, insert, update on table public.heuresis_sessions to authenticated;
grant select, insert on table public.heuresis_card_events to authenticated;
grant select on table public.heuresis_card_stats to authenticated;
grant select on table public.heuresis_pack_stats to authenticated;
grant select on table public.heuresis_pack_overview to authenticated;

revoke execute on function public.heuresis_jsonb_text(jsonb) from public, anon, authenticated;
revoke execute on function public.heuresis_set_updated_at() from public, anon, authenticated;
revoke execute on function public.heuresis_on_pack_insert() from public, anon, authenticated;
revoke execute on function public.heuresis_on_card_insert() from public, anon, authenticated;
revoke execute on function public.heuresis_on_card_delete() from public, anon, authenticated;
revoke execute on function public.heuresis_on_session_insert() from public, anon, authenticated;
revoke execute on function public.heuresis_apply_event() from public, anon, authenticated;
revoke execute on function public.heuresis_record_events(jsonb) from public, anon;
grant execute on function public.heuresis_record_events(jsonb) to authenticated;
