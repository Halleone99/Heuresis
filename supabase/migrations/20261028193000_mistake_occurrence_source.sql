-- Keep mistakes made in actual use separate from failed practice answers.
-- No existing events or recall metadata are changed.
alter table public.knowledge_practice_events
  add column if not exists source text not null default 'practice';
alter table public.knowledge_practice_events
  drop constraint if exists knowledge_practice_events_source_check;
alter table public.knowledge_practice_events
  add constraint knowledge_practice_events_source_check
  check (source in ('practice', 'repeated'));
notify pgrst, 'reload schema';
