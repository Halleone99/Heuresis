alter table public.catalogue_subjects
  add column description text not null default '' check (length(description) <= 300),
  add column illustration jsonb check (illustration is null or (
    jsonb_typeof(illustration) = 'object'
    and coalesce(illustration ->> 'path', '') like (user_id::text || '/%')
    and octet_length(illustration::text) <= 16384
  ));

grant update (description, illustration) on public.catalogue_subjects to authenticated;
