-- Local test seed (NOT part of the project): one account, a small Study library,
-- a Personal OS objectives snapshot and two legacy Personal OS captures.
insert into auth.users(id, email) values ('11111111-1111-4111-8111-111111111111', 'thomas@example.test');
insert into heuresis_collections(id, user_id, title, description, accent, glyph, sort_order) values
 ('c0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Chinese','Mandarin vocabulary and sentences','cinnabar','中',0),
 ('c0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','German','B1 vocabulary','indigo','Ä',1);
insert into heuresis_packs(id, user_id, collection_id, card_type_id, title, description, sort_order) values
 ('a0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','HSK 2 — Time','Time expressions',0),
 ('a0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','Everyday sentences',null,1),
 ('a0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','c0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','B1.2 — Lesson 7','Verben mit Präpositionen',0);
insert into heuresis_cards(user_id, pack_id, data) values
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','{"term":"的时候","reading":"de shíhou","meaning":"when; while; at the time of","example":"吃饭的时候下雨了。","example_reading":"Chīfàn de shíhou xià yǔ le.","example_translation":"It started raining while we were eating."}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','{"term":"以前","reading":"yǐqián","meaning":"before; previously"}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','{"term":"以后","reading":"yǐhòu","meaning":"after; afterwards"}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','{"term":"已经","reading":"yǐjīng","meaning":"already"}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000001','{"term":"刚才","reading":"gāngcái","meaning":"just now"}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000002','{"sentence":"你吃饭了吗？","reading":"Nǐ chīfàn le ma?","translation":"Have you eaten?"}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003','{"term":"sich freuen auf","meaning":"to look forward to","example":"Ich freue mich auf das Wochenende."}'),
 ('11111111-1111-4111-8111-111111111111','a0000000-0000-4000-8000-000000000003','{"term":"sich ärgern über","meaning":"to be annoyed about"}');
insert into language_notebooks(user_id, data, updated_at) values ('11111111-1111-4111-8111-111111111111', '{
  "activeLanguageId":"zh",
  "languages":[{"id":"zh","name":"Chinese"},{"id":"de","name":"German"},{"id":"ru","name":"Russian"}],
  "objectives":[
    {"id":"o1","languageId":"zh","kind":"counted","title":"HSK 2 vocabulary","description":"","current":180,"target":300,"unit":"words","steps":[],"targetDate":"2026-12-31","status":"active","lastWorkedAt":"","updatedAt":""},
    {"id":"o2","languageId":"de","kind":"stepped","title":"Finish B1.2","description":"","current":0,"target":0,"unit":"","steps":[{"id":"s1","label":"Lesson 6","done":true},{"id":"s2","label":"Lesson 7","done":false},{"id":"s3","label":"Lesson 8","done":false}],"targetDate":"","status":"active","lastWorkedAt":"","updatedAt":""}
  ],
  "focusByLanguage":{"zh":"Time expressions"}
}', now());
insert into knowledge_entries(user_id, source_type, entry_type, front, back, subject, status, created_at) values
 ('11111111-1111-4111-8111-111111111111','language','pair','刚才','just now','Chinese','new', now() - interval '20 days'),
 ('11111111-1111-4111-8111-111111111111','language','note','Ask teacher about 了 vs 过',null,'Chinese','new', now() - interval '12 days');
-- A little study history so Progress has something real to read.
insert into heuresis_sessions(id, user_id, pack_id, mode, started_at, ended_at, cards_encountered)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'flashcards', now() - (g || ' days')::interval, now() - (g || ' days')::interval + interval '12 minutes', 5
  from generate_series(1, 9, 2) g;
