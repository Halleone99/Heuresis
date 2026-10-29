-- Explicit, owner-scoped tree removal. Non-empty deletion is never implicit.
-- Called only after the UI offers relocation and obtains a second confirmation.
create or replace function public.heuresis_manage_knowledge_subject(
  p_subject_id uuid, p_action text, p_destination_subject_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_topic_id uuid;
begin
  if v_user is null then raise exception 'Sign in to change your Notebook'; end if;
  perform 1 from public.knowledge_subjects where id = p_subject_id and user_id = v_user for update;
  if not found then raise exception 'Subject not found'; end if;
  if p_action = 'move' then
    if p_destination_subject_id is null or p_destination_subject_id = p_subject_id or
       not exists(select 1 from public.knowledge_subjects where id = p_destination_subject_id and user_id = v_user)
    then raise exception 'Choose another subject you own'; end if;
    -- Preserve the entire nested topic hierarchy and every record, including Trash.
    update public.knowledge_topics set subject_id = p_destination_subject_id
      where subject_id = p_subject_id and user_id = v_user;
  elsif p_action = 'delete' then
    -- Includes archived items; practice events cascade when their records are deleted.
    delete from public.knowledge_records r using public.knowledge_topics t
      where r.topic_id = t.id and r.user_id = v_user
      and t.subject_id = p_subject_id and t.user_id = v_user;
    for v_topic_id in
      with recursive hierarchy as (
        select id, 0 as depth from public.knowledge_topics
          where subject_id = p_subject_id and parent_id is null and user_id = v_user
        union all
        select c.id, h.depth + 1 from public.knowledge_topics c
          join hierarchy h on c.parent_id = h.id where c.user_id = v_user and c.subject_id = p_subject_id
      ) select id from hierarchy order by depth desc
    loop
      delete from public.knowledge_topics where id = v_topic_id and user_id = v_user;
    end loop;
    -- Detect malformed/disconnected hierarchy instead of silently leaving data.
    if exists(select 1 from public.knowledge_topics where subject_id = p_subject_id and user_id = v_user)
    then raise exception 'Some topics could not be removed; no changes were saved'; end if;
  else raise exception 'Unsupported action'; end if;
  delete from public.knowledge_subjects where id = p_subject_id and user_id = v_user;
end; $$;

create or replace function public.heuresis_manage_knowledge_topic(
  p_topic_id uuid, p_action text, p_destination_topic_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_destination_subject uuid;
  v_topic_id uuid;
begin
  if v_user is null then raise exception 'Sign in to change your Notebook'; end if;
  perform 1 from public.knowledge_topics where id = p_topic_id and user_id = v_user for update;
  if not found then raise exception 'Topic not found'; end if;
  if p_action = 'move' then
    select subject_id into v_destination_subject from public.knowledge_topics
      where id = p_destination_topic_id and user_id = v_user;
    if v_destination_subject is null then raise exception 'Choose a destination topic you own'; end if;
    if exists (
      with recursive descendants as (
        select id from public.knowledge_topics where id = p_topic_id and user_id = v_user
        union all
        select c.id from public.knowledge_topics c
          join descendants d on c.parent_id = d.id where c.user_id = v_user
      ) select 1 from descendants where id = p_destination_topic_id
    ) then raise exception 'Cannot move into the topic being removed or its descendants'; end if;
    -- Move records in the root topic, keeping their lesson/practice links and Trash.
    update public.knowledge_records set topic_id = p_destination_topic_id
      where topic_id = p_topic_id and user_id = v_user;
    -- Retain subtopics by attaching direct children to the chosen destination.
    update public.knowledge_topics set parent_id = p_destination_topic_id
      where parent_id = p_topic_id and user_id = v_user;
    with recursive descendants as (
      select id from public.knowledge_topics where parent_id = p_destination_topic_id and user_id = v_user
      union all
      select c.id from public.knowledge_topics c
        join descendants d on c.parent_id = d.id where c.user_id = v_user
    )
    update public.knowledge_topics set subject_id = v_destination_subject
      where id in (select id from descendants) and user_id = v_user;
    -- The broad hierarchy update is harmless for existing destination subtopics,
    -- but all descendants now belong to the destination subject.
  elsif p_action = 'delete' then
    delete from public.knowledge_records
      where user_id = v_user and topic_id in (
        with recursive descendants as (
          select id from public.knowledge_topics where id = p_topic_id and user_id = v_user
          union all select c.id from public.knowledge_topics c
            join descendants d on c.parent_id = d.id where c.user_id = v_user
        ) select id from descendants
      );
    for v_topic_id in
      with recursive descendants as (
        select id, 0 as depth from public.knowledge_topics where id = p_topic_id and user_id = v_user
        union all select c.id, d.depth + 1 from public.knowledge_topics c
          join descendants d on c.parent_id = d.id where c.user_id = v_user
      ) select id from descendants order by depth desc
    loop
      delete from public.knowledge_topics where id = v_topic_id and user_id = v_user;
    end loop;
  else raise exception 'Unsupported action'; end if;
  if p_action = 'move' then
    delete from public.knowledge_topics where id = p_topic_id and user_id = v_user;
  end if;
end; $$;

revoke all on function public.heuresis_manage_knowledge_subject(uuid,text,uuid) from public, anon;
revoke all on function public.heuresis_manage_knowledge_topic(uuid,text,uuid) from public, anon;
grant execute on function public.heuresis_manage_knowledge_subject(uuid,text,uuid) to authenticated;
grant execute on function public.heuresis_manage_knowledge_topic(uuid,text,uuid) to authenticated;
