-- Only the two columns needed for safe relocation are writable here.
-- Existing owner-only RLS policies continue to protect all rows.
grant update (subject_id, parent_id) on public.knowledge_topics to authenticated;
grant update (topic_id) on public.knowledge_records to authenticated;
