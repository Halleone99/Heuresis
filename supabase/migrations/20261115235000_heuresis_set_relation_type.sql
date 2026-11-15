-- Change the classification of a relation without changing its identity or history.
-- Invoker privileges preserve the existing row-level ownership policy.
create or replace function public.heuresis_set_relation_type(
  p_relation_id uuid,
  p_type text
)
returns void
language plpgsql
security invoker
set search_path = 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit related words.';
  end if;
  if p_type not in ('related', 'synonym', 'antonym') then
    raise exception 'Unsupported relation type.';
  end if;

  update public.heuresis_card_relations
  set relation_type = p_type
  where id = p_relation_id and user_id = auth.uid();

  if not found then
    raise exception 'Relation not found or not owned by this user.';
  end if;
end;
$$;

revoke all on function public.heuresis_set_relation_type(uuid, text) from public, anon;
grant execute on function public.heuresis_set_relation_type(uuid, text) to authenticated;
