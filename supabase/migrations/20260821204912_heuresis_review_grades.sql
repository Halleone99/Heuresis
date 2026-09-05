alter table public.heuresis_card_stats
  add column if not exists hard_count integer not null default 0,
  add column if not exists good_count integer not null default 0,
  add column if not exists easy_count integer not null default 0;

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
    'unmarked_interesting'::text
  ]));

create or replace function public.heuresis_apply_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_tid text := new.template_id::text;
begin
  if new.event_type = 'encountered' then
    update heuresis_card_stats
       set encounter_count = encounter_count + 1,
           first_encountered_at = coalesce(first_encountered_at, new.created_at),
           last_encountered_at = greatest(coalesce(last_encountered_at, new.created_at), new.created_at),
           updated_at = now()
     where card_id = new.card_id
     returning encounter_count into v_count;
    if v_count = 1 then
      update heuresis_pack_stats set encountered_cards = encountered_cards + 1, updated_at = now()
       where pack_id = new.pack_id;
    end if;
    update heuresis_sessions set cards_encountered = cards_encountered + 1 where id = new.session_id;
  elsif new.event_type in ('revealed','known','again','hard','good','easy') then
    update heuresis_card_stats
       set study_count = study_count + (new.event_type = 'revealed')::int,
           known_count = known_count + (new.event_type in ('known','good','easy'))::int,
           again_count = again_count + (new.event_type = 'again')::int,
           hard_count = hard_count + (new.event_type = 'hard')::int,
           good_count = good_count + (new.event_type = 'good')::int,
           easy_count = easy_count + (new.event_type = 'easy')::int,
           last_encountered_at = greatest(coalesce(last_encountered_at, new.created_at), new.created_at),
           by_template = case when v_tid is null then by_template else jsonb_set(
             jsonb_set(by_template, array[v_tid], coalesce(by_template -> v_tid, '{}'::jsonb), true),
             array[v_tid, new.event_type],
             to_jsonb(coalesce((by_template #>> array[v_tid, new.event_type])::int, 0) + 1), true
           ) end,
           updated_at = now()
     where card_id = new.card_id;
  end if;
  return new;
end
$$;
