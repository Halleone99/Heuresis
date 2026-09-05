-- ============================================================================
-- HEURESIS — initial schema
-- Recovered from the production Supabase migration ledger (20260821135609).
-- Structural invariant: no scheduling / "next review" column belongs here.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public.heuresis_jsonb_text(doc jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(string_agg(value, ' ' order by key), '')
  from jsonb_each_text(coalesce(doc, '{}'::jsonb))
$$;

create or replace function public.heuresis_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create table public.heuresis_collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  description text,
  accent      text not null default 'ink'
              check (accent in ('cinnabar','indigo','amber','sage','burgundy','slate','ink')),
  glyph       text,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.heuresis_card_types (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  name         text not null,
  description  text,
  field_schema jsonb not null check (jsonb_typeof(field_schema) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.heuresis_study_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  card_type_id uuid not null references public.heuresis_card_types(id) on delete cascade,
  name         text not null,
  front        jsonb not null default '[]' check (jsonb_typeof(front) = 'array'),
  back         jsonb not null default '[]' check (jsonb_typeof(back) = 'array'),
  details      jsonb not null default '[]' check (jsonb_typeof(details) = 'array'),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create table public.heuresis_packs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_id       uuid not null references public.heuresis_collections(id) on delete restrict,
  card_type_id        uuid not null references public.heuresis_card_types(id) on delete restrict,
  default_template_id uuid references public.heuresis_study_templates(id) on delete set null,
  title               text not null,
  description         text,
  theme               text not null default 'paper',
  theme_overrides     jsonb,
  sort_order          integer not null default 0,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.heuresis_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pack_id     uuid not null references public.heuresis_packs(id) on delete cascade,
  data        jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  note        text,
  favourite   boolean not null default false,
  interesting boolean not null default false,
  search_text text not null generated always as
              (public.heuresis_jsonb_text(data) || ' ' || coalesce(note, '')) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.heuresis_tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.heuresis_card_tags (
  card_id uuid not null references public.heuresis_cards(id) on delete cascade,
  tag_id  uuid not null references public.heuresis_tags(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (card_id, tag_id)
);

create table public.heuresis_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pack_id           uuid not null references public.heuresis_packs(id) on delete cascade,
  mode              text not null check (mode in ('browse','flashcards')),
  template_id       uuid references public.heuresis_study_templates(id) on delete set null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  cards_encountered integer not null default 0
);

create table public.heuresis_card_events (
  id              uuid primary key default gen_random_uuid(),
  client_event_id uuid not null,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id         uuid not null references public.heuresis_cards(id) on delete cascade,
  pack_id         uuid not null references public.heuresis_packs(id) on delete cascade,
  session_id      uuid not null references public.heuresis_sessions(id) on delete cascade,
  template_id     uuid references public.heuresis_study_templates(id) on delete set null,
  event_type      text not null check (event_type in
                  ('encountered','revealed','known','again',
                   'favourited','unfavourited','marked_interesting','unmarked_interesting')),
  created_at      timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create table public.heuresis_card_stats (
  card_id              uuid primary key references public.heuresis_cards(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  encounter_count      integer not null default 0,
  study_count          integer not null default 0,
  known_count          integer not null default 0,
  again_count          integer not null default 0,
  first_encountered_at timestamptz,
  last_encountered_at  timestamptz,
  by_template          jsonb not null default '{}',
  updated_at           timestamptz not null default now()
);

create table public.heuresis_pack_stats (
  pack_id           uuid primary key references public.heuresis_packs(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  card_count        integer not null default 0,
  encountered_cards integer not null default 0,
  open_count        integer not null default 0,
  last_opened_at    timestamptz,
  updated_at        timestamptz not null default now()
);

create index heuresis_collections_user_idx on public.heuresis_collections (user_id, sort_order)
  where archived_at is null;
create unique index heuresis_card_types_user_name_uniq on public.heuresis_card_types (user_id, name)
  where user_id is not null;
create index heuresis_templates_type_idx on public.heuresis_study_templates (card_type_id, sort_order);
create index heuresis_packs_collection_idx on public.heuresis_packs (collection_id, sort_order);
create index heuresis_packs_user_idx on public.heuresis_packs (user_id) where archived_at is null;
create index heuresis_cards_pack_idx on public.heuresis_cards (pack_id, created_at);
create index heuresis_cards_fav_idx on public.heuresis_cards (pack_id) where favourite;
create index heuresis_cards_int_idx on public.heuresis_cards (pack_id) where interesting;
create index heuresis_cards_search_idx on public.heuresis_cards
  using gin (search_text extensions.gin_trgm_ops);
create unique index heuresis_tags_user_name_uniq on public.heuresis_tags (user_id, lower(name));
create index heuresis_card_tags_tag_idx on public.heuresis_card_tags (tag_id);
create index heuresis_sessions_pack_idx on public.heuresis_sessions (pack_id, started_at desc);
create index heuresis_events_card_idx on public.heuresis_card_events (card_id, created_at);
create index heuresis_events_session_idx on public.heuresis_card_events (session_id);
create index heuresis_events_user_time_idx on public.heuresis_card_events (user_id, created_at desc);
create unique index heuresis_events_encounter_uniq on public.heuresis_card_events (session_id, card_id)
  where event_type = 'encountered';
create index heuresis_stats_last_idx on public.heuresis_card_stats
  (user_id, last_encountered_at desc nulls last);
create trigger heuresis_collections_touch before update on public.heuresis_collections
  for each row execute function public.heuresis_set_updated_at();
create trigger heuresis_card_types_touch before update on public.heuresis_card_types
  for each row execute function public.heuresis_set_updated_at();
create trigger heuresis_packs_touch before update on public.heuresis_packs
  for each row execute function public.heuresis_set_updated_at();
create trigger heuresis_cards_touch before update on public.heuresis_cards
  for each row execute function public.heuresis_set_updated_at();

create or replace function public.heuresis_on_pack_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into heuresis_pack_stats (pack_id, user_id) values (new.id, new.user_id)
  on conflict (pack_id) do nothing;
  return new;
end
$$;
create trigger heuresis_pack_insert after insert on public.heuresis_packs
  for each row execute function public.heuresis_on_pack_insert();

create or replace function public.heuresis_on_card_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into heuresis_card_stats (card_id, user_id) values (new.id, new.user_id)
  on conflict (card_id) do nothing;
  update heuresis_pack_stats set card_count = card_count + 1, updated_at = now()
   where pack_id = new.pack_id;
  return new;
end
$$;
create trigger heuresis_card_insert after insert on public.heuresis_cards
  for each row execute function public.heuresis_on_card_insert();

create or replace function public.heuresis_on_card_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_enc integer;
begin
  select encounter_count into v_enc from heuresis_card_stats where card_id = old.id;
  update heuresis_pack_stats
     set card_count = greatest(card_count - 1, 0),
         encountered_cards = case when coalesce(v_enc, 0) > 0 then greatest(encountered_cards - 1, 0) else encountered_cards end,
         updated_at = now()
   where pack_id = old.pack_id;
  return old;
end
$$;
create trigger heuresis_card_delete before delete on public.heuresis_cards
  for each row execute function public.heuresis_on_card_delete();

create or replace function public.heuresis_on_session_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update heuresis_pack_stats
     set open_count = open_count + 1,
         last_opened_at = new.started_at,
         updated_at = now()
   where pack_id = new.pack_id;
  return new;
end
$$;
create trigger heuresis_session_insert after insert on public.heuresis_sessions
  for each row execute function public.heuresis_on_session_insert();

create or replace function public.heuresis_apply_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_tid text := new.template_id::text;
begin
  if new.event_type = 'encountered' then
    update heuresis_card_stats
       set encounter_count = encounter_count + 1,
           first_encountered_at = coalesce(first_encountered_at, new.created_at),
           last_encountered_at = greatest(coalesce(last_encountered_at, new.created_at), new.created_at),
           updated_at = now()
     where card_id = new.card_id
     returning encounter_count into v_count;
    if v_count = 1 then
      update heuresis_pack_stats set encountered_cards = encountered_cards + 1, updated_at = now()
       where pack_id = new.pack_id;
    end if;
    update heuresis_sessions set cards_encountered = cards_encountered + 1 where id = new.session_id;
  elsif new.event_type in ('revealed','known','again') then
    update heuresis_card_stats
       set study_count = study_count + (new.event_type = 'revealed')::int,
           known_count = known_count + (new.event_type = 'known')::int,
           again_count = again_count + (new.event_type = 'again')::int,
           last_encountered_at = greatest(coalesce(last_encountered_at, new.created_at), new.created_at),
           by_template = case when v_tid is null then by_template else jsonb_set(
             jsonb_set(by_template, array[v_tid], coalesce(by_template -> v_tid, '{}'::jsonb), true),
             array[v_tid, new.event_type],
             to_jsonb(coalesce((by_template #>> array[v_tid, new.event_type])::int, 0) + 1), true
           ) end,
           updated_at = now()
     where card_id = new.card_id;
  end if;
  return new;
end
$$;
create trigger heuresis_event_apply after insert on public.heuresis_card_events
  for each row execute function public.heuresis_apply_event();

create or replace function public.heuresis_record_events(events jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if jsonb_typeof(events) is distinct from 'array' then raise exception 'heuresis_record_events expects a jsonb array'; end if;
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

create or replace function public.heuresis_rebuild_stats()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'heuresis_rebuild_stats requires an authenticated user'; end if;
  delete from heuresis_card_stats where user_id = v_user;
  insert into heuresis_card_stats
    (card_id, user_id, encounter_count, study_count, known_count, again_count, first_encountered_at, last_encountered_at, by_template, updated_at)
  select c.id, c.user_id,
         count(*) filter (where e.event_type = 'encountered'),
         count(*) filter (where e.event_type = 'revealed'),
         count(*) filter (where e.event_type = 'known'),
         count(*) filter (where e.event_type = 'again'),
         min(e.created_at) filter (where e.event_type = 'encountered'),
         max(e.created_at) filter (where e.event_type in ('encountered','revealed','known','again')),
         coalesce((select jsonb_object_agg(t.tid, t.counts) from (
           select e2.template_id::text as tid, jsonb_object_agg(e2.event_type, e2.n) as counts
           from (select template_id, event_type, count(*) as n from heuresis_card_events
                 where card_id = c.id and template_id is not null and event_type in ('revealed','known','again')
                 group by template_id, event_type) e2
           group by e2.template_id
         ) t), '{}'::jsonb), now()
  from heuresis_cards c left join heuresis_card_events e on e.card_id = c.id
  where c.user_id = v_user group by c.id, c.user_id;
  delete from heuresis_pack_stats where user_id = v_user;
  insert into heuresis_pack_stats
    (pack_id, user_id, card_count, encountered_cards, open_count, last_opened_at, updated_at)
  select p.id, p.user_id,
         (select count(*) from heuresis_cards c where c.pack_id = p.id),
         (select count(*) from heuresis_card_stats s join heuresis_cards c on c.id = s.card_id where c.pack_id = p.id and s.encounter_count > 0),
         (select count(*) from heuresis_sessions se where se.pack_id = p.id),
         (select max(se.started_at) from heuresis_sessions se where se.pack_id = p.id), now()
  from heuresis_packs p where p.user_id = v_user;
end
$$;

insert into public.heuresis_card_types (id, user_id, name, description, field_schema) values
('00000000-0000-4000-8000-000000000001', null, 'Vocabulary — Chinese', 'Chinese word or phrase with pinyin, meaning and example.',
 '[{"key":"term","label":"Chinese","script":"han","role":"term","required":true},{"key":"reading","label":"Pinyin","script":"latn","role":"reading"},{"key":"meaning","label":"English","script":"latn","role":"meaning","required":true},{"key":"alt_meanings","label":"Alternative meanings","script":"latn","role":"extra"},{"key":"example","label":"Example (Chinese)","script":"han","role":"example"},{"key":"example_reading","label":"Example (Pinyin)","script":"latn","role":"example_reading"},{"key":"example_translation","label":"Example (English)","script":"latn","role":"example_translation"},{"key":"grammar_note","label":"Grammar note","script":"latn","role":"extra"}]'::jsonb),
('00000000-0000-4000-8000-000000000002', null, 'Vocabulary — Cyrillic', 'Russian (or other Cyrillic) word with meaning and example.',
 '[{"key":"term","label":"Word","script":"cyrl","role":"term","required":true},{"key":"reading","label":"Stressed form","script":"cyrl","role":"reading"},{"key":"meaning","label":"English","script":"latn","role":"meaning","required":true},{"key":"alt_meanings","label":"Alternative meanings","script":"latn","role":"extra"},{"key":"example","label":"Example","script":"cyrl","role":"example"},{"key":"example_translation","label":"Example (English)","script":"latn","role":"example_translation"},{"key":"usage","label":"Usage note","script":"latn","role":"extra"}]'::jsonb),
('00000000-0000-4000-8000-000000000003', null, 'Vocabulary — Latin script', 'German (or any Latin-script) word with meaning and example.',
 '[{"key":"term","label":"Word","script":"latn","role":"term","required":true},{"key":"meaning","label":"English","script":"latn","role":"meaning","required":true},{"key":"alt_meanings","label":"Alternative meanings","script":"latn","role":"extra"},{"key":"example","label":"Example","script":"latn","role":"example"},{"key":"example_translation","label":"Example (English)","script":"latn","role":"example_translation"},{"key":"usage","label":"Usage note","script":"latn","role":"extra"}]'::jsonb),
('00000000-0000-4000-8000-000000000004', null, 'Sentence — Chinese', 'A full Chinese sentence worth knowing.',
 '[{"key":"sentence","label":"Chinese","script":"han","role":"term","required":true},{"key":"reading","label":"Pinyin","script":"latn","role":"reading"},{"key":"translation","label":"English","script":"latn","role":"meaning","required":true},{"key":"note","label":"Note","script":"latn","role":"extra"}]'::jsonb),
('00000000-0000-4000-8000-000000000005', null, 'Concept', 'A concept, idea or term from any field of knowledge.',
 '[{"key":"concept","label":"Concept","script":"latn","role":"term","required":true},{"key":"thinker","label":"Thinker / origin","script":"latn","role":"reading"},{"key":"definition","label":"Definition","script":"latn","role":"meaning","required":true},{"key":"explanation","label":"Explanation","script":"latn","role":"example"},{"key":"quotation","label":"Quotation","script":"latn","role":"extra"},{"key":"interpretation","label":"My interpretation","script":"latn","role":"extra"}]'::jsonb);

insert into public.heuresis_study_templates (id, user_id, card_type_id, name, front, back, details, sort_order) values
('00000000-0000-4000-8000-000000000101', null, '00000000-0000-4000-8000-000000000001', 'Chinese → English', '["term","reading"]', '["meaning"]', '["example","example_reading","example_translation"]', 0),
('00000000-0000-4000-8000-000000000102', null, '00000000-0000-4000-8000-000000000001', 'English → Chinese', '["meaning"]', '["term","reading"]', '["example","example_reading","example_translation"]', 1),
('00000000-0000-4000-8000-000000000103', null, '00000000-0000-4000-8000-000000000002', 'Russian → English', '["term"]', '["meaning"]', '["example","example_translation"]', 0),
('00000000-0000-4000-8000-000000000104', null, '00000000-0000-4000-8000-000000000002', 'English → Russian', '["meaning"]', '["term"]', '["example","example_translation"]', 1),
('00000000-0000-4000-8000-000000000105', null, '00000000-0000-4000-8000-000000000003', 'Word → English', '["term"]', '["meaning"]', '["example","example_translation"]', 0),
('00000000-0000-4000-8000-000000000106', null, '00000000-0000-4000-8000-000000000003', 'English → Word', '["meaning"]', '["term"]', '["example","example_translation"]', 1),
('00000000-0000-4000-8000-000000000107', null, '00000000-0000-4000-8000-000000000004', 'Sentence → English', '["sentence","reading"]', '["translation"]', '["note"]', 0),
('00000000-0000-4000-8000-000000000108', null, '00000000-0000-4000-8000-000000000005', 'Concept → Definition', '["concept","thinker"]', '["definition"]', '["explanation","quotation","interpretation"]', 0);

create or replace view public.heuresis_pack_overview with (security_invoker = true) as
select p.id, p.user_id, p.collection_id, p.card_type_id, p.default_template_id,
       p.title, p.description, p.theme, p.sort_order, p.archived_at, p.created_at, p.updated_at,
       coalesce(s.card_count, 0) as card_count,
       coalesce(s.encountered_cards, 0) as encountered_cards,
       coalesce(s.open_count, 0) as open_count,
       s.last_opened_at,
       c.title as collection_title, c.accent as collection_accent, c.glyph as collection_glyph
from public.heuresis_packs p
join public.heuresis_collections c on c.id = p.collection_id
left join public.heuresis_pack_stats s on s.pack_id = p.id;

alter table public.heuresis_collections enable row level security;
alter table public.heuresis_card_types enable row level security;
alter table public.heuresis_study_templates enable row level security;
alter table public.heuresis_packs enable row level security;
alter table public.heuresis_cards enable row level security;
alter table public.heuresis_tags enable row level security;
alter table public.heuresis_card_tags enable row level security;
alter table public.heuresis_sessions enable row level security;
alter table public.heuresis_card_events enable row level security;
alter table public.heuresis_card_stats enable row level security;
alter table public.heuresis_pack_stats enable row level security;

create policy heuresis_collections_select on public.heuresis_collections for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_collections_insert on public.heuresis_collections for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_collections_update on public.heuresis_collections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy heuresis_collections_delete on public.heuresis_collections for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_packs_select on public.heuresis_packs for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_packs_insert on public.heuresis_packs for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_collections c where c.id = collection_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid())))
  and (default_template_id is null or exists (select 1 from public.heuresis_study_templates st where st.id = default_template_id and st.card_type_id = card_type_id and (st.user_id is null or st.user_id = (select auth.uid()))))
);
create policy heuresis_packs_update on public.heuresis_packs for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_collections c where c.id = collection_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid())))
  and (default_template_id is null or exists (select 1 from public.heuresis_study_templates st where st.id = default_template_id and st.card_type_id = card_type_id and (st.user_id is null or st.user_id = (select auth.uid()))))
);
create policy heuresis_packs_delete on public.heuresis_packs for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_cards_select on public.heuresis_cards for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_cards_insert on public.heuresis_cards for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid())));
create policy heuresis_cards_update on public.heuresis_cards for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid())));
create policy heuresis_cards_delete on public.heuresis_cards for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_tags_select on public.heuresis_tags for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_tags_insert on public.heuresis_tags for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_tags_update on public.heuresis_tags for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy heuresis_tags_delete on public.heuresis_tags for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_card_tags_select on public.heuresis_card_tags for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_card_tags_insert on public.heuresis_card_tags for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_cards c where c.id = card_id and c.user_id = (select auth.uid()))
  and exists (select 1 from public.heuresis_tags t where t.id = tag_id and t.user_id = (select auth.uid()))
);
create policy heuresis_card_tags_delete on public.heuresis_card_tags for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_sessions_select on public.heuresis_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_sessions_insert on public.heuresis_sessions for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
  and (template_id is null or exists (
    select 1 from public.heuresis_study_templates st join public.heuresis_packs p on p.id = pack_id
    where st.id = template_id and st.card_type_id = p.card_type_id and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);
create policy heuresis_sessions_update on public.heuresis_sessions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid())));

create policy heuresis_events_select on public.heuresis_card_events for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_events_insert on public.heuresis_card_events for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.heuresis_cards c where c.id = card_id and c.user_id = (select auth.uid()) and c.pack_id = pack_id)
  and exists (select 1 from public.heuresis_sessions s where s.id = session_id and s.user_id = (select auth.uid()) and s.pack_id = pack_id)
  and exists (select 1 from public.heuresis_packs p where p.id = pack_id and p.user_id = (select auth.uid()))
  and (template_id is null or exists (
    select 1 from public.heuresis_study_templates st join public.heuresis_packs p on p.id = pack_id
    where st.id = template_id and st.card_type_id = p.card_type_id and (st.user_id is null or st.user_id = (select auth.uid()))
  ))
);

create policy heuresis_card_types_select on public.heuresis_card_types for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy heuresis_card_types_insert on public.heuresis_card_types for insert to authenticated with check (user_id = (select auth.uid()));
create policy heuresis_card_types_update on public.heuresis_card_types for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy heuresis_card_types_delete on public.heuresis_card_types for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_templates_select on public.heuresis_study_templates for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy heuresis_templates_insert on public.heuresis_study_templates for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid()))));
create policy heuresis_templates_update on public.heuresis_study_templates for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and exists (select 1 from public.heuresis_card_types ct where ct.id = card_type_id and (ct.user_id is null or ct.user_id = (select auth.uid()))));
create policy heuresis_templates_delete on public.heuresis_study_templates for delete to authenticated using (user_id = (select auth.uid()));

create policy heuresis_card_stats_select on public.heuresis_card_stats for select to authenticated using (user_id = (select auth.uid()));
create policy heuresis_pack_stats_select on public.heuresis_pack_stats for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.heuresis_collections from anon;
revoke all on table public.heuresis_card_types from anon;
revoke all on table public.heuresis_study_templates from anon;
revoke all on table public.heuresis_packs from anon;
revoke all on table public.heuresis_cards from anon;
revoke all on table public.heuresis_tags from anon;
revoke all on table public.heuresis_card_tags from anon;
revoke all on table public.heuresis_sessions from anon;
revoke all on table public.heuresis_card_events from anon;
revoke all on table public.heuresis_card_stats from anon;
revoke all on table public.heuresis_pack_stats from anon;
revoke all on table public.heuresis_pack_overview from anon;

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
revoke execute on function public.heuresis_rebuild_stats() from public, anon;
grant execute on function public.heuresis_record_events(jsonb) to authenticated;
grant execute on function public.heuresis_rebuild_stats() to authenticated;
