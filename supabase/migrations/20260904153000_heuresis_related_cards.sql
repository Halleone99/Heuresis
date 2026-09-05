-- Related vocabulary is a first-class Heuresis card identity.
-- Ordinary topic reads remain role='main'; related-only cards keep independent
-- review/event history and can later be promoted without changing card id.

alter table public.heuresis_cards
  add column role text not null default 'main'
    check (role in ('main', 'related'));

alter table public.heuresis_cards
  add column dedupe_key text generated always as (
    lower(btrim(normalize(coalesce(data ->> 'term', ''), NFC)))
  ) stored;

create index heuresis_cards_pack_role_idx
  on public.heuresis_cards (user_id, pack_id, role);

create index heuresis_cards_dedupe_idx
  on public.heuresis_cards (user_id, pack_id, dedupe_key);

create unique index heuresis_cards_related_uniq
  on public.heuresis_cards (user_id, pack_id, dedupe_key)
  where role = 'related' and dedupe_key <> '';

alter table public.heuresis_sessions
  drop constraint if exists heuresis_sessions_mode_check;

alter table public.heuresis_sessions
  add constraint heuresis_sessions_mode_check
  check (mode in ('browse', 'flashcards', 'sort', 'related'));

create table public.heuresis_card_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.heuresis_cards(id) on delete cascade,
  target_card_id uuid not null references public.heuresis_cards(id) on delete restrict,
  relation_type text not null check (relation_type in ('synonym', 'antonym', 'related')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint heuresis_card_relations_no_self check (source_card_id <> target_card_id)
);

create unique index heuresis_card_relations_uniq
  on public.heuresis_card_relations (source_card_id, target_card_id, relation_type);
create index heuresis_card_relations_target_idx
  on public.heuresis_card_relations (target_card_id);
create index heuresis_card_relations_user_source_idx
  on public.heuresis_card_relations (user_id, source_card_id);

alter table public.heuresis_card_relations enable row level security;

create policy heuresis_card_relations_select
  on public.heuresis_card_relations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy heuresis_card_relations_insert
  on public.heuresis_card_relations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_cards c
      where c.id = source_card_id and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.heuresis_cards c
      where c.id = target_card_id and c.user_id = (select auth.uid())
    )
  );

create policy heuresis_card_relations_update
  on public.heuresis_card_relations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.heuresis_cards c
      where c.id = source_card_id and c.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.heuresis_cards c
      where c.id = target_card_id and c.user_id = (select auth.uid())
    )
  );

create policy heuresis_card_relations_delete
  on public.heuresis_card_relations
  for delete to authenticated
  using (user_id = (select auth.uid()));

create trigger heuresis_card_relations_touch
before update on public.heuresis_card_relations
for each row execute function public.heuresis_set_updated_at();

create or replace view public.heuresis_related_catalogue
with (security_invoker = true) as
select
  r.id as relation_id,
  r.user_id,
  r.relation_type,
  r.created_at,
  src.id as source_card_id,
  src.pack_id,
  p.title as pack_title,
  src.data ->> 'term' as source_term,
  src.data ->> 'reading' as source_reading,
  src.data ->> 'meaning' as source_meaning,
  coalesce(tag_data.source_tags, array[]::text[]) as source_tags,
  tgt.id as target_card_id,
  tgt.role as target_role,
  tgt.data ->> 'term' as term,
  tgt.data ->> 'reading' as reading,
  tgt.data ->> 'meaning' as meaning
from public.heuresis_card_relations r
join public.heuresis_cards src on src.id = r.source_card_id
join public.heuresis_cards tgt on tgt.id = r.target_card_id
join public.heuresis_packs p on p.id = src.pack_id
left join lateral (
  select array_agg(t.name order by t.sort_order, t.name) as source_tags
  from public.heuresis_card_tags ct
  join public.heuresis_tags t on t.id = ct.tag_id
  where ct.card_id = src.id
) tag_data on true;

create or replace function public.heuresis_add_related_word(
  p_source_card_id uuid,
  p_term text,
  p_reading text default null,
  p_meaning text default null,
  p_relation_type text default 'related'
)
returns table (relation_id uuid, target_card_id uuid, target_role text)
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.heuresis_cards%rowtype;
  v_target public.heuresis_cards%rowtype;
  v_term text := btrim(normalize(coalesce(p_term, ''), NFC));
  v_reading text := nullif(btrim(normalize(coalesce(p_reading, ''), NFKC)), '');
  v_meaning text := nullif(btrim(coalesce(p_meaning, '')), '');
begin
  if v_uid is null then
    raise exception 'Sign in before adding related vocabulary.';
  end if;
  if v_term = '' then
    raise exception 'A word or expression is required.';
  end if;
  if p_relation_type not in ('synonym', 'antonym', 'related') then
    raise exception 'Invalid relation type.';
  end if;

  select * into v_source
  from public.heuresis_cards
  where id = p_source_card_id and user_id = v_uid;
  if not found then
    raise exception 'Source card not found.';
  end if;

  select * into v_target
  from public.heuresis_cards
  where user_id = v_uid
    and pack_id = v_source.pack_id
    and dedupe_key = lower(btrim(normalize(v_term, NFC)))
  order by (role = 'main') desc, created_at asc
  limit 1;

  if not found then
    insert into public.heuresis_cards (user_id, pack_id, data, role)
    values (
      v_uid,
      v_source.pack_id,
      jsonb_strip_nulls(jsonb_build_object(
        'term', v_term,
        'reading', v_reading,
        'meaning', v_meaning
      )),
      'related'
    )
    returning * into v_target;
  else
    update public.heuresis_cards
    set data = data
      || case
        when nullif(btrim(data ->> 'reading'), '') is null and v_reading is not null
          then jsonb_build_object('reading', v_reading)
        else '{}'::jsonb
      end
      || case
        when nullif(btrim(data ->> 'meaning'), '') is null and v_meaning is not null
          then jsonb_build_object('meaning', v_meaning)
        else '{}'::jsonb
      end
    where id = v_target.id
    returning * into v_target;
  end if;

  if v_target.id = v_source.id then
    raise exception 'A card cannot be related to itself.';
  end if;

  insert into public.heuresis_card_relations (
    user_id, source_card_id, target_card_id, relation_type
  ) values (
    v_uid, v_source.id, v_target.id, p_relation_type
  )
  on conflict (source_card_id, target_card_id, relation_type)
  do update set updated_at = now()
  returning id into relation_id;

  target_card_id := v_target.id;
  target_role := v_target.role;
  return next;
end;
$$;

create or replace function public.heuresis_promote_related_card(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  update public.heuresis_cards
  set role = 'main'
  where id = p_card_id
    and user_id = auth.uid()
    and role = 'related';

  if not found then
    raise exception 'Related card not found.';
  end if;
end;
$$;

-- Pack statistics represent ordinary topic cards only. Related-only cards keep
-- their own card stats and event history without inflating the topic headline.
create or replace function public.heuresis_on_card_insert()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  insert into public.heuresis_card_stats (card_id, user_id)
  values (new.id, new.user_id)
  on conflict (card_id) do nothing;

  if new.role = 'main' then
    update public.heuresis_pack_stats
    set card_count = card_count + 1, updated_at = now()
    where pack_id = new.pack_id;
  end if;
  return new;
end;
$$;

create or replace function public.heuresis_on_card_delete()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_enc integer;
begin
  select encounter_count into v_enc
  from public.heuresis_card_stats
  where card_id = old.id;

  if old.role = 'main' then
    update public.heuresis_pack_stats
    set card_count = greatest(card_count - 1, 0),
        encountered_cards = case
          when coalesce(v_enc, 0) > 0 then greatest(encountered_cards - 1, 0)
          else encountered_cards
        end,
        updated_at = now()
    where pack_id = old.pack_id;
  end if;
  return old;
end;
$$;

create or replace function public.heuresis_on_card_role_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_enc integer;
begin
  if old.role = new.role then
    return new;
  end if;

  select encounter_count into v_enc
  from public.heuresis_card_stats
  where card_id = new.id;

  if old.role = 'main' and new.role = 'related' then
    update public.heuresis_pack_stats
    set card_count = greatest(card_count - 1, 0),
        encountered_cards = case
          when coalesce(v_enc, 0) > 0 then greatest(encountered_cards - 1, 0)
          else encountered_cards
        end,
        updated_at = now()
    where pack_id = new.pack_id;
  elsif old.role = 'related' and new.role = 'main' then
    update public.heuresis_pack_stats
    set card_count = card_count + 1,
        encountered_cards = encountered_cards + case when coalesce(v_enc, 0) > 0 then 1 else 0 end,
        updated_at = now()
    where pack_id = new.pack_id;
  end if;
  return new;
end;
$$;

drop trigger if exists heuresis_card_role_change on public.heuresis_cards;
create trigger heuresis_card_role_change
after update of role on public.heuresis_cards
for each row execute function public.heuresis_on_card_role_change();

create or replace function public.heuresis_apply_event()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_count integer;
  v_tid text := new.template_id::text;
  v_is_main boolean := false;
begin
  if new.event_type = 'encountered' then
    update public.heuresis_card_stats
    set encounter_count = encounter_count + 1,
        first_encountered_at = coalesce(first_encountered_at, new.created_at),
        last_encountered_at = greatest(coalesce(last_encountered_at, new.created_at), new.created_at),
        updated_at = now()
    where card_id = new.card_id
    returning encounter_count into v_count;

    if v_count = 1 then
      select (role = 'main') into v_is_main
      from public.heuresis_cards
      where id = new.card_id;
      if coalesce(v_is_main, false) then
        update public.heuresis_pack_stats
        set encountered_cards = encountered_cards + 1, updated_at = now()
        where pack_id = new.pack_id;
      end if;
    end if;

    update public.heuresis_sessions
    set cards_encountered = cards_encountered + 1
    where id = new.session_id;
  elsif new.event_type in ('revealed','known','again','hard','good','easy') then
    update public.heuresis_card_stats
    set study_count = study_count + (new.event_type = 'revealed')::int,
        known_count = known_count + (new.event_type in ('known','good','easy'))::int,
        again_count = again_count + (new.event_type = 'again')::int,
        hard_count = hard_count + (new.event_type = 'hard')::int,
        good_count = good_count + (new.event_type = 'good')::int,
        easy_count = easy_count + (new.event_type = 'easy')::int,
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
end;
$$;

grant select on public.heuresis_related_catalogue to authenticated;
grant select, insert, update, delete on public.heuresis_card_relations to authenticated;
grant execute on function public.heuresis_add_related_word(uuid, text, text, text, text) to authenticated;
grant execute on function public.heuresis_promote_related_card(uuid) to authenticated;
