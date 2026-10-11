-- Direct checks of the v2 knowledge migration: constraints, triggers, grants and RLS.
-- Run against a scratch copy, e.g.:
--   psql -c "create database mig_scratch template heuresis_v2_baseline"
--   psql -d mig_scratch -f sql/mig_checks.sql      (lines marked "expect ERROR" must fail)
insert into knowledge_subjects(id,user_id,name) values ('5ab00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Chinese') on conflict do nothing;
insert into knowledge_topics(id,user_id,subject_id,name) values ('70b00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001','Inbox') on conflict do nothing;
insert into knowledge_records(id,user_id,topic_id,kind,title,body) values
 ('e0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','','v1 quick note'),
 ('e0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','Lesson · 11 Oct 2026','## What we covered') on conflict do nothing;
insert into knowledge_records(id,user_id,topic_id,kind,attempt,correction,explanation,status) values
 ('e0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','mistake','我吃饭了的时候','我吃饭的时候','no 了 inside 的时候 clause','needs_practice') on conflict do nothing;
\set ON_ERROR_STOP 0
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
\echo '--- nested topics'
insert into knowledge_topics(id,user_id,subject_id,parent_id,name) values ('70b00000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001',null,'Grammar');
insert into knowledge_topics(id,user_id,subject_id,parent_id,name) values ('70b00000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001','70b00000-0000-4000-8000-000000000002','Time expressions');
insert into knowledge_topics(user_id,subject_id,parent_id,name) values ('11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001','70b00000-0000-4000-8000-000000000003','Inbox');
\echo 'expect ERROR cycle:'
update knowledge_topics set parent_id='70b00000-0000-4000-8000-000000000003' where id='70b00000-0000-4000-8000-000000000002';
\echo 'expect ERROR duplicate sibling name:'
insert into knowledge_topics(user_id,subject_id,parent_id,name) values ('11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001',null,'grammar');
\echo 'expect ERROR delete topic with children:'
delete from knowledge_topics where id='70b00000-0000-4000-8000-000000000002';
\echo '--- lessons and links'
insert into knowledge_records(id,user_id,topic_id,kind,title,body,lesson_date) values ('e0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','lesson','HSK2 — Chapter 4','', '2026-10-11');
insert into knowledge_records(id,user_id,topic_id,kind,body,category,lesson_id) values ('e0000000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','吃饭的时候下雨了 — why is 了 at the end?','question','e0000000-0000-4000-8000-000000000010');
insert into knowledge_records(id,user_id,topic_id,kind,attempt,status,lesson_id) values ('e0000000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','mistake','我昨天去了商店了','needs_practice','e0000000-0000-4000-8000-000000000010');
\echo 'expect ERROR link to non-lesson:'
insert into knowledge_records(user_id,topic_id,kind,body,lesson_id) values ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','x','e0000000-0000-4000-8000-000000000001');
\echo 'expect ERROR empty note:'
insert into knowledge_records(user_id,topic_id,kind,body) values ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','  ');
\echo 'expect ERROR bad category:'
insert into knowledge_records(user_id,topic_id,kind,body,category) values ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','x','bogus');
\echo '--- updated_at only bumps on content change'
select updated_at as before_pin from knowledge_records where id='e0000000-0000-4000-8000-000000000011' \gset
update knowledge_records set pinned=true where id='e0000000-0000-4000-8000-000000000011';
select (updated_at = :'before_pin') as pin_kept_updated_at from knowledge_records where id='e0000000-0000-4000-8000-000000000011';
update knowledge_records set body = body || '!' where id='e0000000-0000-4000-8000-000000000011';
select (updated_at > :'before_pin') as edit_bumped_updated_at from knowledge_records where id='e0000000-0000-4000-8000-000000000011';
\echo 'expect ERROR kind not updatable:'
update knowledge_records set kind='lesson' where id='e0000000-0000-4000-8000-000000000001';
\echo '--- practice events'
insert into knowledge_practice_events(record_id,outcome,answer) values ('e0000000-0000-4000-8000-000000000003','correct','我吃饭的时候');
update knowledge_records set recall_streak=1, last_recalled_at=now(), recall_due_at=now()+interval '3 days' where id='e0000000-0000-4000-8000-000000000003';
\echo '--- deleting a lesson keeps its captures'
delete from knowledge_records where id='e0000000-0000-4000-8000-000000000010';
select id, kind, lesson_id from knowledge_records where id in ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000012');
\echo '--- other users see nothing'
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false);
select count(*) as other_user_rows from knowledge_records;
select count(*) as other_user_events from knowledge_practice_events;
reset role;
\echo '--- subject delete cascades through nested topics'
begin; delete from knowledge_subjects where id='5ab00000-0000-4000-8000-000000000001'; select count(*) as topics_left from knowledge_topics; rollback;
