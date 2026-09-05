-- Related vocabulary RPCs operate entirely inside the caller's existing RLS
-- scope, so they do not need definer privileges. Expose them only to signed-in
-- users. Trigger-only functions should not be callable as API RPCs.

alter function public.heuresis_add_related_word(uuid, text, text, text, text) security invoker;
alter function public.heuresis_promote_related_card(uuid) security invoker;
alter function public.heuresis_remove_related_relation(uuid) security invoker;

revoke all on function public.heuresis_add_related_word(uuid, text, text, text, text) from public, anon;
revoke all on function public.heuresis_promote_related_card(uuid) from public, anon;
revoke all on function public.heuresis_remove_related_relation(uuid) from public, anon;

grant execute on function public.heuresis_add_related_word(uuid, text, text, text, text) to authenticated;
grant execute on function public.heuresis_promote_related_card(uuid) to authenticated;
grant execute on function public.heuresis_remove_related_relation(uuid) to authenticated;

revoke all on function public.heuresis_on_card_role_change() from public, anon, authenticated;
