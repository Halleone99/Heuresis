-- Remove anonymous EXECUTE access to Heuresis RPCs.
-- A live read-only permissions audit on 2026-10-24 found these five exposed
-- through PUBLIC role inheritance, including two SECURITY DEFINER routines.
-- Keep app access for signed-in users; RPC internals still check ownership.

revoke execute on function public.heuresis_connect_cards(uuid, uuid, text) from public, anon;
grant execute on function public.heuresis_connect_cards(uuid, uuid, text) to authenticated;

revoke execute on function public.heuresis_create_topic_from_related_words(uuid, text, uuid[]) from public, anon;
grant execute on function public.heuresis_create_topic_from_related_words(uuid, text, uuid[]) to authenticated;

revoke execute on function public.heuresis_customize_pack_structure(uuid, jsonb) from public, anon;
grant execute on function public.heuresis_customize_pack_structure(uuid, jsonb) to authenticated;

revoke execute on function public.heuresis_list_related_catalogue(uuid, uuid) from public, anon;
grant execute on function public.heuresis_list_related_catalogue(uuid, uuid) to authenticated;

revoke execute on function public.heuresis_set_card_tags(uuid, uuid[]) from public, anon;
grant execute on function public.heuresis_set_card_tags(uuid, uuid[]) to authenticated;
