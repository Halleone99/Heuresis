-- A related-word card can be the target of a relation. Deleting its topic should
-- remove that relation as well, rather than blocking deletion of the whole pack.
alter table public.heuresis_card_relations
  drop constraint if exists heuresis_card_relations_target_card_id_fkey;

alter table public.heuresis_card_relations
  add constraint heuresis_card_relations_target_card_id_fkey
  foreign key (target_card_id)
  references public.heuresis_cards(id)
  on delete cascade;
