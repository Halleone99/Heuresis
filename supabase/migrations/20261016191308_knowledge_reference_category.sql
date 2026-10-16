-- References are existing Notebook documents with a distinct category.
-- No new table or duplicated editor/storage. Existing user-owned RLS stays in force.
alter table public.knowledge_records
  drop constraint if exists knowledge_records_v2_fields_check;
alter table public.knowledge_records
  add constraint knowledge_records_v2_fields_check check (
    (category is null or category in ('note', 'question', 'grammar', 'vocabulary', 'phrase', 'reference'))
    and (lesson_id is null or (kind <> 'lesson' and lesson_id <> id))
    and (lesson_date is null or kind = 'lesson')
    and recall_streak between 0 and 1000
  );
