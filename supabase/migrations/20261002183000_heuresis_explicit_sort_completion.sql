-- Sort completion is now represented explicitly by _sorted_at. Interest rank is
-- useful metadata but must not imply completion: a user can set interest and then
-- Skip, and that card should return to Sort later.
--
-- Older Heuresis builds used interest_rank as a fallback completion signal. Give
-- those existing cards an honest migration-time baseline so the behavioural fix
-- does not unexpectedly throw previously prepared cards back into the queue. The
-- timestamp means "known to be sorted by this migration", not the historical time
-- at which the user originally sorted the card.
update public.heuresis_cards c
set data = jsonb_set(c.data, '{_sorted_at}', to_jsonb(now()), true)
where c.role = 'main'
  and c.interest_rank is not null
  and nullif(btrim(c.data ->> '_sorted_at'), '') is null;
