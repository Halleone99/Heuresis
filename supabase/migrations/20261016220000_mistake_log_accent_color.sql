-- One optional visual accent for mistake entries. Existing knowledge stays unchanged.
ALTER TABLE public.knowledge_records
  ADD COLUMN IF NOT EXISTS accent_color text;
ALTER TABLE public.knowledge_records
  DROP CONSTRAINT IF EXISTS knowledge_records_accent_color_check;
ALTER TABLE public.knowledge_records
  ADD CONSTRAINT knowledge_records_accent_color_check
  CHECK (accent_color IS NULL OR accent_color IN ('red', 'amber', 'green', 'blue', 'violet'));
COMMENT ON COLUMN public.knowledge_records.accent_color
  IS 'Optional visual colour selected by the user for a Mistake Log entry.';
