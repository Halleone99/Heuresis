drop policy if exists heuresis_events_delete on public.heuresis_card_events;
create policy heuresis_events_delete
on public.heuresis_card_events
for delete
to authenticated
using (user_id = (select auth.uid()));

grant delete on table public.heuresis_card_events to authenticated;

alter function public.heuresis_toggle_learning_action(uuid,uuid,uuid,text) security invoker;
