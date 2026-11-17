-- Applied knowledge: one built-in card type for rules, regulations and procedures.
--
-- Additive only. Like the existing built-in types it has no owner (user_id is null), so every
-- account can create topics with it. No existing card type, template, card, round or review
-- row is changed. Safe to run more than once.
--
-- Learn recognises an Applied card by its field roles (condition, exception, step, case,
-- outcome, source); see src/lib/teachingShape.ts. Lists (conditions, exceptions, steps) are
-- written one item per line. Further cases can be added on the card as notes under Cases.

insert into public.heuresis_card_types (id, user_id, name, description, field_schema) values
('00000000-0000-4000-8000-000000000006', null, 'Rule — Applied',
 'A rule, regulation or procedure: what it requires, when it applies, its exceptions, its steps and a case.',
 '[{"key":"rule","label":"Rule or procedure","script":"latn","role":"term","required":true},
   {"key":"statement","label":"What it requires","script":"latn","role":"meaning","required":true},
   {"key":"conditions","label":"Applies when (one per line)","script":"latn","role":"condition"},
   {"key":"exceptions","label":"Unless (one per line)","script":"latn","role":"exception"},
   {"key":"steps","label":"Steps, in order (one per line)","script":"latn","role":"step"},
   {"key":"case","label":"A case: a realistic situation","script":"latn","role":"case"},
   {"key":"outcome","label":"What follows, and why (after a colon)","script":"latn","role":"outcome"},
   {"key":"source","label":"Source (article, version)","script":"latn","role":"source"},
   {"key":"note","label":"Note","script":"latn","role":"extra"}]'::jsonb)
on conflict (id) do nothing;

insert into public.heuresis_study_templates (id, user_id, card_type_id, name, front, back, details, sort_order) values
('00000000-0000-4000-8000-000000000109', null, '00000000-0000-4000-8000-000000000006', 'Rule → What it requires',
 '["rule"]', '["statement"]', '["conditions","exceptions","steps","source"]', 0),
('00000000-0000-4000-8000-000000000110', null, '00000000-0000-4000-8000-000000000006', 'Case → Outcome',
 '["case"]', '["outcome","rule"]', '["statement","conditions","exceptions"]', 1)
on conflict (id) do nothing;
