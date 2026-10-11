-- Shared Knowledge workspace. New tables only: never alter the legacy
-- public.knowledge_entries capture queue used by Personal OS.
create or replace function public.knowledge_workspace_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.knowledge_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists knowledge_subjects_owner_name_idx
  on public.knowledge_subjects(user_id, lower(name));

create table if not exists public.knowledge_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null,
  name text not null check (name = btrim(name) and length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint knowledge_topics_owner_parent_fk foreign key (subject_id, user_id)
    references public.knowledge_subjects(id, user_id) on delete cascade
);
create unique index if not exists knowledge_topics_subject_name_idx
  on public.knowledge_topics(subject_id, lower(name));
create index if not exists knowledge_topics_owner_idx on public.knowledge_topics(user_id);

-- "knowledge_entries" already exists with a different Personal OS capture
-- schema. knowledge_records holds organised notes and corrections instead.
create table if not exists public.knowledge_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic_id uuid not null,
  kind text not null check (kind in ('note', 'mistake')),
  title text not null default '',
  body text not null default '',
  attempt text not null default '',
  correction text not null default '',
  explanation text not null default '',
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_records_owner_topic_fk foreign key (topic_id, user_id)
    references public.knowledge_topics(id, user_id) on delete cascade,
  constraint knowledge_records_status_check check (
    (kind = 'note' and status is null) or
    (kind = 'mistake' and status is not null and status in ('needs_practice', 'understood'))
  ),
  constraint knowledge_records_content_check check (
    (kind = 'note' and length(btrim(body)) > 0 and attempt = '' and correction = '' and explanation = '')
    or (kind = 'mistake' and length(btrim(attempt)) > 0 and length(btrim(correction)) > 0 and body = '')
  ),
  constraint knowledge_records_length_check check (
    length(title) <= 200 and length(body) <= 50000 and
    length(attempt) <= 5000 and length(correction) <= 5000 and length(explanation) <= 10000
  )
);
create index if not exists knowledge_records_owner_recent_idx
  on public.knowledge_records(user_id, created_at desc);
create index if not exists knowledge_records_topic_idx
  on public.knowledge_records(topic_id, user_id);

drop trigger if exists knowledge_workspace_subject_touch on public.knowledge_subjects;
create trigger knowledge_workspace_subject_touch before update on public.knowledge_subjects
  for each row execute function public.knowledge_workspace_touch();
drop trigger if exists knowledge_workspace_topic_touch on public.knowledge_topics;
create trigger knowledge_workspace_topic_touch before update on public.knowledge_topics
  for each row execute function public.knowledge_workspace_touch();
drop trigger if exists knowledge_workspace_record_touch on public.knowledge_records;
create trigger knowledge_workspace_record_touch before update on public.knowledge_records
  for each row execute function public.knowledge_workspace_touch();

alter table public.knowledge_subjects enable row level security;
alter table public.knowledge_topics enable row level security;
alter table public.knowledge_records enable row level security;

drop policy if exists knowledge_subjects_owner on public.knowledge_subjects;
create policy knowledge_subjects_owner on public.knowledge_subjects
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists knowledge_topics_owner on public.knowledge_topics;
create policy knowledge_topics_owner on public.knowledge_topics
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists knowledge_records_owner on public.knowledge_records;
create policy knowledge_records_owner on public.knowledge_records
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.knowledge_subjects, public.knowledge_topics, public.knowledge_records
  from public, anon, authenticated;
grant select, insert, delete on public.knowledge_subjects, public.knowledge_topics, public.knowledge_records to authenticated;
grant update (name) on public.knowledge_subjects to authenticated;
grant update (name) on public.knowledge_topics to authenticated;
grant update (topic_id, title, body, attempt, correction, explanation, status)
  on public.knowledge_records to authenticated;
revoke all on function public.knowledge_workspace_touch() from public, anon, authenticated;
