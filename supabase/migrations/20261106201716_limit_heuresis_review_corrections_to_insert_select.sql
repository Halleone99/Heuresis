-- A learner can append and view corrections, never silently rewrite history.
revoke update, delete, truncate, references, trigger on public.heuresis_review_corrections from authenticated;
