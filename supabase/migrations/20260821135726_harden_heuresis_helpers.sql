create or replace function public.heuresis_jsonb_text(doc jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(string_agg(value, ' ' order by key), '')
  from jsonb_each_text(coalesce(doc, '{}'::jsonb))
$$;

create or replace function public.heuresis_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Maintenance-only RPC: keep available to service_role but do not expose a
-- SECURITY DEFINER entry point to ordinary signed-in clients.
revoke execute on function public.heuresis_rebuild_stats() from public, anon, authenticated;
grant execute on function public.heuresis_rebuild_stats() to service_role;
