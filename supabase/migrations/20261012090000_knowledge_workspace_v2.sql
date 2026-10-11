-- Knowledge workspace v2: lessons, nested topics, lesson-linked captures,
-- note categories, pinning and a light mistake-recall schedule.
--
-- Safety properties
--   * Additive only. No existing row is updated, copied or deleted.
--   * Existing v1 rows satisfy every new/relaxed constraint (verified locally
--     against the v1 schema with sample rows before release).
--   * public.knowledge_entries (Personal OS capture queue) is not touched.
--   * Requires PostgreSQL 15+ for "on delete set null (lesson_id)".
--
-- Rollback (only if no v2 rows exist yet — lessons, empty-correction mistakes
-- or nested topics would violate the restored v1 checks):
--   drop table public.knowledge_practice_events;
--   alter table public.knowledge_records drop column category, drop column lesson_id,
--     drop column lesson_date, drop column pinned, drop column recall_streak,
--     drop column last_recalled_at, drop column recall_due_at;
--   alter table public.knowledge_topics drop column parent_id;
--   then restore the v1 check constraints and topic name index from
--   20261011190000_create_knowledge_workspace.sql.

-- ---------------------------------------------------------------------------
-- 1. Nested topics: Chinese → Grammar → Time expressions
-- ---------------------------------------------------------------------------
alter table public.knowledge_topics add column if not exists parent_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_topics_owner_parent_topic_fk') then
    -- NO ACTION: a topic that still has sub-topics cannot be deleted on its own,
    -- while deleting a whole subject (which cascades to all its topics) still works.
    alter table public.knowledge_topics
      add constraint knowledge_topics_owner_parent_topic_fk
      foreign key (parent_id, user_id) references public.knowledge_topics(id, user_id);
  end if;
end $$;

-- Names are unique among siblings rather than across the whole subject, so
-- "B1.1 → Lesson 1" and "B1.2 → Lesson 1" can coexist.
drop index if exists public.knowledge_topics_subject_name_idx;
create unique index if not exists knowledge_topics_sibling_name_idx
  on public.knowledge_topics(subject_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists knowledge_topics_parent_idx
  on public.knowledge_topics(parent_id, user_id) where parent_id is not null;

create or replace function public.knowledge_topics_validate_parent()
returns trigger language plpgsql set search_path = '' as $$
declare
  cursor_id uuid := new.parent_id;
  parent_subject uuid;
  depth integer := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'A topic cannot be its own parent.'; end if;
  select t.subject_id into parent_subject from public.knowledge_topics t
    where t.id = new.parent_id and t.user_id = new.user_id;
  if parent_subject is null then raise exception 'Parent topic not found.'; end if;
  if parent_subject <> new.subject_id then raise exception 'A sub-topic must stay in the same subject as its parent.'; end if;
  while cursor_id is not null loop
    depth := depth + 1;
    if depth > 4 then raise exception 'Topics can be nested at most four levels deep.'; end if;
    select t.parent_id into cursor_id from public.knowledge_topics t where t.id = cursor_id;
    if cursor_id = new.id then raise exception 'Moving this topic there would create a loop.'; end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists knowledge_topics_validate_parent on public.knowledge_topics;
create trigger knowledge_topics_validate_parent before insert or update of parent_id, subject_id
  on public.knowledge_topics for each row execute function public.knowledge_topics_validate_parent();

-- ---------------------------------------------------------------------------
-- 2. Records: lessons, lesson links, categories, pinning, recall schedule
-- ---------------------------------------------------------------------------
alter table public.knowledge_records
  add column if not exists category text,
  add column if not exists lesson_id uuid,
  add column if not exists lesson_date date,
  add column if not exists pinned boolean not null default false,
  add column if not exists recall_streak integer not null default 0,
  add column if not exists last_recalled_at timestamptz,
  add column if not exists recall_due_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_records_id_user_id_key') then
    alter table public.knowledge_records add constraint knowledge_records_id_user_id_key unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_records_owner_lesson_fk') then
    -- Deleting a lesson keeps the notes and mistakes captured during it.
    alter table public.knowledge_records
      add constraint knowledge_records_owner_lesson_fk
      foreign key (lesson_id, user_id) references public.knowledge_records(id, user_id)
      on delete set null (lesson_id);
  end if;
end $$;

alter table public.knowledge_records drop constraint if exists knowledge_records_kind_check;
alter table public.knowledge_records add constraint knowledge_records_kind_check
  check (kind in ('note', 'lesson', 'mistake'));

alter table public.knowledge_records drop constraint if exists knowledge_records_status_check;
alter table public.knowledge_records add constraint knowledge_records_status_check check (
  (kind in ('note', 'lesson') and status is null) or
  (kind = 'mistake' and status is not null and status in ('needs_practice', 'understood'))
);

-- Relaxed for capture-first use: a lesson may start empty, and a mistake may be
-- recorded with only the attempt (or only the correction) and clarified later.
alter table public.knowledge_records drop constraint if exists knowledge_records_content_check;
alter table public.knowledge_records add constraint knowledge_records_content_check check (
  (kind = 'note' and length(btrim(body)) > 0 and attempt = '' and correction = '' and explanation = '')
  or (kind = 'lesson' and attempt = '' and correction = '' and explanation = '')
  or (kind = 'mistake' and (length(btrim(attempt)) > 0 or length(btrim(correction)) > 0) and body = '')
);

alter table public.knowledge_records drop constraint if exists knowledge_records_v2_fields_check;
alter table public.knowledge_records add constraint knowledge_records_v2_fields_check check (
  (category is null or category in ('note', 'question', 'grammar', 'vocabulary', 'phrase'))
  and (lesson_id is null or (kind <> 'lesson' and lesson_id <> id))
  and (lesson_date is null or kind = 'lesson')
  and recall_streak between 0 and 1000
);

create or replace function public.knowledge_records_validate_lesson()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lesson_id is not null and not exists (
    select 1 from public.knowledge_records r
    where r.id = new.lesson_id and r.user_id = new.user_id and r.kind = 'lesson'
  ) then
    raise exception 'Captures can only be attached to a lesson.';
  end if;
  return new;
end;
$$;
drop trigger if exists knowledge_records_validate_lesson on public.knowledge_records;
create trigger knowledge_records_validate_lesson before insert or update of lesson_id
  on public.knowledge_records for each row execute function public.knowledge_records_validate_lesson();

-- "Recently edited" should mean the content changed, not that a note was
-- pinned or a mistake was practised.
create or replace function public.knowledge_records_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.topic_id, new.title, new.body, new.attempt, new.correction, new.explanation,
      new.status, new.category, new.lesson_id, new.lesson_date)
     is distinct from
     (old.topic_id, old.title, old.body, old.attempt, old.correction, old.explanation,
      old.status, old.category, old.lesson_id, old.lesson_date) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
drop trigger if exists knowledge_workspace_record_touch on public.knowledge_records;
create trigger knowledge_workspace_record_touch before update on public.knowledge_records
  for each row execute function public.knowledge_records_touch();

create index if not exists knowledge_records_lesson_idx
  on public.knowledge_records(lesson_id, user_id) where lesson_id is not null;
create index if not exists knowledge_records_owner_updated_idx
  on public.knowledge_records(user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- 3. Mistake recall history (append-only evidence; never a "mastered" flag)
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_practice_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_id uuid not null,
  outcome text not null check (outcome in ('correct', 'incorrect')),
  answer text not null default '' check (length(answer) <= 5000),
  created_at timestamptz not null default now(),
  constraint knowledge_practice_events_owner_record_fk foreign key (record_id, user_id)
    references public.knowledge_records(id, user_id) on delete cascade
);
create index if not exists knowledge_practice_events_owner_recent_idx
  on public.knowledge_practice_events(user_id, created_at desc);
create index if not exists knowledge_practice_events_record_idx
  on public.knowledge_practice_events(record_id, user_id);

alter table public.knowledge_practice_events enable row level security;
drop policy if exists knowledge_practice_events_owner on public.knowledge_practice_events;
create policy knowledge_practice_events_owner on public.knowledge_practice_events
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Privileges (column-scoped updates, as in v1)
-- ---------------------------------------------------------------------------
revoke all on public.knowledge_practice_events from public, anon, authenticated;
grant select, insert, delete on public.knowledge_practice_events to authenticated;
grant update (name, parent_id) on public.knowledge_topics to authenticated;
grant update (topic_id, title, body, attempt, correction, explanation, status,
  category, lesson_id, lesson_date, pinned, recall_streak, last_recalled_at, recall_due_at)
  on public.knowledge_records to authenticated;
revoke all on function public.knowledge_topics_validate_parent() from public, anon, authenticated;
revoke all on function public.knowledge_records_validate_lesson() from public, anon, authenticated;
revoke all on function public.knowledge_records_touch() from public, anon, authenticated;

notify pgrst, 'reload schema';
