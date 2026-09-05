alter table public.heuresis_card_events
  drop constraint if exists heuresis_card_events_event_type_check;

alter table public.heuresis_card_events
  add constraint heuresis_card_events_event_type_check
  check (event_type = any (array[
    'encountered'::text,
    'revealed'::text,
    'known'::text,
    'again'::text,
    'hard'::text,
    'good'::text,
    'easy'::text,
    'favourited'::text,
    'unfavourited'::text,
    'marked_interesting'::text,
    'unmarked_interesting'::text,
    'exercise_write'::text,
    'exercise_sentence'::text,
    'exercise_rephrase'::text,
    'exercise_example'::text,
    'exercise_say'::text,
    'exercise_hear'::text
  ]));

create unique index if not exists heuresis_events_exercise_once_per_card_session
  on public.heuresis_card_events (session_id, card_id, event_type)
  where event_type like 'exercise_%';
