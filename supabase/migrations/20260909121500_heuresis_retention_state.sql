alter table public.heuresis_cards
  add column if not exists retention text not null default 'learning'
  check (retention in ('reference', 'learning'));

-- Existing ordinary cards were already behaving as review material. Connected
-- raw identities were not, so make that distinction explicit now.
update public.heuresis_cards
set retention = case when role = 'related' then 'reference' else 'learning' end;

create index if not exists heuresis_cards_retention_idx
  on public.heuresis_cards (user_id, pack_id, role, retention);

create or replace function public.heuresis_set_card_retention(
  p_card_id uuid,
  p_retention text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_retention not in ('reference', 'learning') then raise exception 'Invalid retention state'; end if;

  update public.heuresis_cards
  set retention = p_retention
  where id = p_card_id
    and user_id = auth.uid()
    and role = 'main';

  if not found then raise exception 'Catalogue entry unavailable'; end if;
end;
$$;

revoke all on function public.heuresis_set_card_retention(uuid, text) from public, anon;
grant execute on function public.heuresis_set_card_retention(uuid, text) to authenticated;

-- Raw connected identities always remain reference knowledge. When one is
-- promoted into a normal topic card, it becomes learning material by default.
create or replace function public.heuresis_sync_card_retention()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.role = 'related' then
    new.retention := 'reference';
  elsif tg_op = 'UPDATE'
    and old.role = 'related'
    and new.role = 'main'
    and new.retention = old.retention then
    new.retention := 'learning';
  end if;
  return new;
end;
$$;

revoke all on function public.heuresis_sync_card_retention() from public, anon, authenticated;
drop trigger if exists heuresis_sync_card_retention on public.heuresis_cards;
create trigger heuresis_sync_card_retention
before insert or update of role, retention on public.heuresis_cards
for each row execute function public.heuresis_sync_card_retention();
