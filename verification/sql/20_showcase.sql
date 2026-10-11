-- Showcase content for screenshots (local only).
\set uid '''11111111-1111-4111-8111-111111111111'''
insert into knowledge_subjects(id,user_id,name,created_at,updated_at) values
 ('5ab00000-0000-4000-8000-0000000000c1',:uid,'Chinese',now()-interval '20 days',now()),
 ('5ab00000-0000-4000-8000-0000000000d1',:uid,'German',now()-interval '20 days',now()),
 ('5ab00000-0000-4000-8000-0000000000e1',:uid,'Russian',now()-interval '20 days',now());
insert into knowledge_topics(id,user_id,subject_id,parent_id,name) values
 ('70b00000-0000-4000-8000-0000000000c1',:uid,'5ab00000-0000-4000-8000-0000000000c1',null,'Grammar'),
 ('70b00000-0000-4000-8000-0000000000c2',:uid,'5ab00000-0000-4000-8000-0000000000c1','70b00000-0000-4000-8000-0000000000c1','Time expressions'),
 ('70b00000-0000-4000-8000-0000000000c3',:uid,'5ab00000-0000-4000-8000-0000000000c1','70b00000-0000-4000-8000-0000000000c1','Aspect: 了 and 过'),
 ('70b00000-0000-4000-8000-0000000000c4',:uid,'5ab00000-0000-4000-8000-0000000000c1',null,'Lessons'),
 ('70b00000-0000-4000-8000-0000000000c5',:uid,'5ab00000-0000-4000-8000-0000000000c1',null,'Blocks of meaning'),
 ('70b00000-0000-4000-8000-0000000000c6',:uid,'5ab00000-0000-4000-8000-0000000000c1',null,'Inbox'),
 ('70b00000-0000-4000-8000-0000000000d1',:uid,'5ab00000-0000-4000-8000-0000000000d1',null,'B1.2'),
 ('70b00000-0000-4000-8000-0000000000d2',:uid,'5ab00000-0000-4000-8000-0000000000d1','70b00000-0000-4000-8000-0000000000d1','Lesson 7'),
 ('70b00000-0000-4000-8000-0000000000d3',:uid,'5ab00000-0000-4000-8000-0000000000d1',null,'Inbox'),
 ('70b00000-0000-4000-8000-0000000000e1',:uid,'5ab00000-0000-4000-8000-0000000000e1',null,'Cases');
insert into knowledge_records(id,user_id,topic_id,kind,title,body,category,lesson_date,pinned,created_at,updated_at) values
 ('e0000000-0000-4000-8000-0000000000a1',:uid,'70b00000-0000-4000-8000-0000000000c2','note','的时候 — “when / while”',
 E'# The pattern\n> [!rule]\n> **Clause + 的时候, main clause.** The first clause sets the time frame; the main clause says what happened inside it.\n\n# Examples\n> [!example]\n> 吃饭的时候下雨了。\n> Chīfàn de shíhou xià yǔ le.\n> It started raining while we were eating.\n>\n> 我小的时候住在上海。\n> Wǒ xiǎo de shíhou zhù zài Shànghǎi.\n> When I was little I lived in Shanghai.\n\n# Watch out\n- No 了 *inside* the 的时候 clause: ~~我吃饭了的时候~~ → 我吃饭的时候\n- 了 at the end of the main clause marks a ==change of state==: it *started* raining.\n- Compare [[以前 / 以后]] for “before / after”.\n\n> [!tip]\n> Think of 的时候 as a container: “the time of eating”.',
 'grammar',null,true,now()-interval '9 days',now()-interval '2 hours'),
 ('e0000000-0000-4000-8000-0000000000a2',:uid,'70b00000-0000-4000-8000-0000000000c2','note','以前 / 以后',
 E'**X 以前** = before X · **X 以后** = after X\n\n> [!example]\n> 下课以后我们去吃饭吧。\n> Xiàkè yǐhòu wǒmen qù chīfàn ba.\n> Let''s go and eat after class.\n\nAlso used alone: 以前 = in the past, 以后 = in future.',
 'grammar',null,false,now()-interval '8 days',now()-interval '3 days'),
 ('e0000000-0000-4000-8000-0000000000a3',:uid,'70b00000-0000-4000-8000-0000000000c3','note','',
 E'Is 过 possible with 的时候? 我去过中国的时候… sounds wrong — why?','question',null,false,now()-interval '2 days',now()-interval '2 days'),
 ('e0000000-0000-4000-8000-0000000000a4',:uid,'70b00000-0000-4000-8000-0000000000c5','note','一边…一边…',
 E'> [!example]\n> 他一边吃饭一边看手机。\n> Tā yìbiān chīfàn yìbiān kàn shǒujī.\n> He looks at his phone while eating.\n\nReusable frame for two simultaneous actions by **the same person**.','phrase',null,true,now()-interval '6 days',now()-interval '1 day'),
 ('e0000000-0000-4000-8000-0000000000b1',:uid,'70b00000-0000-4000-8000-0000000000c4','lesson','HSK 2 · Chapter 4',
 E'# Grammar\n的时候 — expressing that one event happens during another. See [[的时候 — “when / while”]].\n\n# New expressions\n- 下雨 xià yǔ — to rain\n- 刚才 gāngcái — just now\n- 一边…一边… — doing two things at once\n\n# To revisit\n- Difference between 刚才 and 刚',
 null,(now()-interval '1 day')::date,false,now()-interval '1 day',now()-interval '20 hours'),
 ('e0000000-0000-4000-8000-0000000000b2',:uid,'70b00000-0000-4000-8000-0000000000c4','lesson','HSK 2 · Chapter 3',
 E'# Grammar\n是…的 for emphasising time, place or manner of past events.\n\n> [!example]\n> 我是昨天来的。\n> Wǒ shì zuótiān lái de.\n> I came *yesterday*.',
 null,(now()-interval '8 days')::date,false,now()-interval '8 days',now()-interval '8 days'),
 ('e0000000-0000-4000-8000-0000000000b3',:uid,'70b00000-0000-4000-8000-0000000000d2','lesson','B1.2 · Lektion 7',
 E'# Verben mit Präpositionen\n> [!rule]\n> sich freuen **auf** + Akk. — future · sich freuen **über** + Akk. — present/past\n\n> [!example]\n> Ich freue mich auf das Wochenende.\n> I''m looking forward to the weekend.',
 null,(now()-interval '4 days')::date,false,now()-interval '4 days',now()-interval '4 days'),
 ('e0000000-0000-4000-8000-0000000000a5',:uid,'70b00000-0000-4000-8000-0000000000e1','note','Предложный падеж',
 E'Prepositional case after **в / на** for location.\n\n> [!example]\n> Я живу в Москве.\n> I live in Moscow.',
 'grammar',null,false,now()-interval '12 days',now()-interval '12 days');
insert into knowledge_records(id,user_id,topic_id,kind,title,body,category,lesson_id,created_at,updated_at) values
 ('e0000000-0000-4000-8000-0000000000c1',:uid,'70b00000-0000-4000-8000-0000000000c4','note','',E'吃饭的时候下雨了 — why is 了 at the end?','question','e0000000-0000-4000-8000-0000000000b1',now()-interval '1 day' + interval '10 minutes',now()-interval '1 day' + interval '10 minutes'),
 ('e0000000-0000-4000-8000-0000000000c2',:uid,'70b00000-0000-4000-8000-0000000000c4','note','',E'下课以后 — after class','note','e0000000-0000-4000-8000-0000000000b1',now()-interval '1 day' + interval '24 minutes',now()-interval '1 day' + interval '24 minutes');
insert into knowledge_records(id,user_id,topic_id,kind,title,attempt,correction,explanation,status,lesson_id,recall_streak,last_recalled_at,recall_due_at,created_at,updated_at) values
 ('e0000000-0000-4000-8000-0000000000d1',:uid,'70b00000-0000-4000-8000-0000000000c2','mistake','了 inside a 的时候 clause','我吃饭了的时候，他来了。','我吃饭的时候，他来了。','的时候 marks a time frame; the completion marker 了 does not belong inside it.','needs_practice','e0000000-0000-4000-8000-0000000000b1',1,now()-interval '2 days',now()-interval '1 hour',now()-interval '1 day' + interval '31 minutes',now()-interval '1 day'),
 ('e0000000-0000-4000-8000-0000000000d2',:uid,'70b00000-0000-4000-8000-0000000000d2','mistake','','Ich freue mich über das Wochenende.','Ich freue mich auf das Wochenende.','Looking forward to something in the future: sich freuen auf.','understood','e0000000-0000-4000-8000-0000000000b3',3,now()-interval '1 day',now()+interval '20 days',now()-interval '4 days',now()-interval '1 day'),
 ('e0000000-0000-4000-8000-0000000000d3',:uid,'70b00000-0000-4000-8000-0000000000c6','mistake','','我昨天去了商店了。','','','needs_practice',null,0,null,null,now()-interval '3 hours',now()-interval '3 hours'),
 ('e0000000-0000-4000-8000-0000000000d4',:uid,'70b00000-0000-4000-8000-0000000000e1','mistake','','Я живу в Москва.','Я живу в Москве.','в + prepositional case for location: Москва → Москве.','needs_practice',null,0,null,null,now()-interval '10 days',now()-interval '10 days');
insert into knowledge_practice_events(user_id,record_id,outcome,answer,created_at) values
 (:uid,'e0000000-0000-4000-8000-0000000000d2','correct','Ich freue mich auf das Wochenende.',now()-interval '15 days'),
 (:uid,'e0000000-0000-4000-8000-0000000000d2','correct','Ich freue mich auf das Wochenende.',now()-interval '10 days'),
 (:uid,'e0000000-0000-4000-8000-0000000000d2','correct','Ich freue mich auf das Wochenende',now()-interval '1 day'),
 (:uid,'e0000000-0000-4000-8000-0000000000d1','incorrect','我吃饭了的时候他来了',now()-interval '3 days'),
 (:uid,'e0000000-0000-4000-8000-0000000000d1','correct','我吃饭的时候，他来了。',now()-interval '2 days'),
 (:uid,'e0000000-0000-4000-8000-0000000000d4','incorrect','Я живу в Москву.',now()-interval '6 days');
-- Review events for Progress (graded answers in existing sessions).
insert into heuresis_card_events(client_event_id,user_id,card_id,pack_id,session_id,event_type,created_at)
select gen_random_uuid(), :uid, c.id, s.pack_id, s.id, (array['good','good','easy','hard','again'])[1 + (abs(hashtext(c.id::text || s.id::text)) % 5)], s.started_at + interval '2 minutes'
from heuresis_sessions s join heuresis_cards c on c.pack_id = s.pack_id;
