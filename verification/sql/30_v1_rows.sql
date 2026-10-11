insert into knowledge_subjects(id,user_id,name) values ('5ab00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Chinese');
insert into knowledge_topics(id,user_id,subject_id,name) values ('70b00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','5ab00000-0000-4000-8000-000000000001','Inbox');
insert into knowledge_records(user_id,topic_id,kind,title,body) values
 ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','','v1 quick note about 了'),
 ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','note','Lesson · 11 Oct 2026', E'## What we covered\n的时候');
insert into knowledge_records(user_id,topic_id,kind,attempt,correction,status) values
 ('11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-000000000001','mistake','我吃饭了的时候','我吃饭的时候','needs_practice');
