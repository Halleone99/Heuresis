-- Knowledge mode belongs to the collection, not the study stage or the card.
-- Existing Chinese / German / Russian collections remain in Languages.
-- Reserve future General and Concepts values without exposing unfinished modes in the UI.
alter table public.heuresis_collections
  add column if not exists study_mode text not null default 'languages';

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.heuresis_collections'::regclass
      and conname = 'heuresis_collections_study_mode_valid'
  ) then
    alter table public.heuresis_collections
      add constraint heuresis_collections_study_mode_valid
      check (study_mode in ('languages', 'applied', 'general', 'concepts'));
  end if;
end $;

comment on column public.heuresis_collections.study_mode is
  'Exercise-family mode for Study: languages, applied; general/concepts reserved for later.';
