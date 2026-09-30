alter table public.heuresis_study_templates
  add column if not exists prompt_mode text not null default 'text'
    check (prompt_mode in ('text', 'audio'));

comment on column public.heuresis_study_templates.prompt_mode is
  'text = side 1 renders its fields as text. audio = side 1 is spoken only and shows no text; the keys in front name which field supplies the spoken text.';
