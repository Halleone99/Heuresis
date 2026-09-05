create or replace function public.heuresis_on_card_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_enc integer;
begin
  select encounter_count into v_enc
  from public.heuresis_card_stats
  where card_id = old.id;

  -- When a whole topic is deleted, card deletion happens through ON DELETE CASCADE
  -- after the parent pack row is already disappearing. In that case, do not try
  -- to update heuresis_pack_stats for a pack that no longer exists.
  if old.role = 'main' and exists (
    select 1 from public.heuresis_packs p where p.id = old.pack_id
  ) then
    update public.heuresis_pack_stats
    set card_count = greatest(card_count - 1, 0),
        encountered_cards = case
          when coalesce(v_enc, 0) > 0 then greatest(encountered_cards - 1, 0)
          else encountered_cards
        end,
        updated_at = now()
    where pack_id = old.pack_id;
  end if;

  return old;
end;
$function$;
