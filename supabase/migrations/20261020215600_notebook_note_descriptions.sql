-- Note-card descriptions are written by the user, never taken from the note body.
-- Keep them attached to the record so they sync across devices.
ALTER TABLE public.knowledge_records
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE public.knowledge_records
  DROP CONSTRAINT IF EXISTS knowledge_records_description_length_check;
ALTER TABLE public.knowledge_records
  ADD CONSTRAINT knowledge_records_description_length_check
  CHECK (char_length(description) <= 240);

GRANT UPDATE (description) ON TABLE public.knowledge_records TO authenticated;
COMMENT ON COLUMN public.knowledge_records.description
  IS 'Optional short description displayed on Notebook cards; independent of the note body.';
