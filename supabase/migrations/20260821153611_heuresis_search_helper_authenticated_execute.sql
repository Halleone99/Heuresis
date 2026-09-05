revoke all on function public.heuresis_jsonb_text(jsonb) from public, anon;
grant execute on function public.heuresis_jsonb_text(jsonb) to authenticated, service_role;
