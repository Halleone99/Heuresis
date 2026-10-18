-- Optional visual identity for Notebook notes, independent from their title and body.
-- Metadata stays with the record across desktop, mobile and offline synchronisation.
ALTER TABLE public.knowledge_records
  ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE public.knowledge_records
  DROP CONSTRAINT IF EXISTS knowledge_records_icon_check;
ALTER TABLE public.knowledge_records
  ADD CONSTRAINT knowledge_records_icon_check
  CHECK (icon IS NULL OR (char_length(icon) BETWEEN 1 AND 32 AND icon = btrim(icon)));

GRANT UPDATE (icon) ON TABLE public.knowledge_records TO authenticated;
COMMENT ON COLUMN public.knowledge_records.icon
  IS 'Optional emoji or symbol used to identify a Notebook note.';

COMMENT ON COLUMN public.knowledge_records.accent_color
  IS 'Optional visual accent for Notebook notes or Mistake Log entries.';
