#!/usr/bin/env bash
# Applies the Learn migration (20261110120000_heuresis_learn_rounds.sql) to a database
# that already holds Study, Notebook and review data, including cards written by the
# earlier ten-exercise Learning, then proves that:
#   - every existing table, row and policy is unchanged (the card history only gains
#     one 'learning_phase' starting row per card that already had a phase);
#   - running the migration a second time changes nothing;
#   - card writes keep working, even with a malformed phase value, and phase changes
#     are added to the card history;
#   - Learn's tables can only be written through its functions, by their owner.
# Needs the harness from setup.sh (PostgreSQL on $PGHOST:$PGPORT). Leaves the test
# databases as they were.
set -euo pipefail
cd "$(dirname "$0")/.."
PGHOST="${PGHOST:-/tmp}"; PGPORT="${PGPORT:-54329}"
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q -At"
DB=heuresis_learn_migration
LEARN=../supabase/migrations/20261110120000_heuresis_learn_rounds.sql
V2=20261012090000_knowledge_workspace_v2.sql
fail() { echo "✗ $1"; exit 1; }
pass() { echo "  ✓ $1"; }

echo "— Learn migration on existing data"
$P -c "drop database if exists $DB" >/dev/null
$P -c "create database $DB template heuresis_v1_baseline"
for f in ../supabase/migrations/*.sql; do
  name="$(basename "$f")"
  [[ "$name" < "$V2" ]] && continue
  [[ "$name" == "$(basename "$LEARN")" ]] && continue
  $P -d "$DB" -1 -f "$f" >/dev/null 2>&1 || fail "migration failed: $name"
done
$P -d "$DB" -f sql/20_showcase.sql >/dev/null
A=11111111-1111-4111-8111-111111111111
B=22222222-2222-4222-8222-222222222222
# Cards as the earlier Learning left them: one in Learning, one moved to Review, one with a
# damaged phase value; plus review history that must survive untouched.
$P -d "$DB" >/dev/null <<SQL
update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1',
  '{"phase":"learning","cycle":1,"completed":["typing","meaning"],"history":[{"at":"2026-11-01T10:00:00.000Z","cycle":1,"kind":"enter_learning"},{"at":"2026-11-01T10:05:00.000Z","cycle":1,"kind":"exercise","exercise":"typing","verification":"automatic","evidence":"x"}]}')
  where id = (select id from heuresis_cards where user_id = '$A' order by created_at, id limit 1);
update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1',
  '{"phase":"review","cycle":1,"completed":[],"history":[{"at":"2026-11-01T10:00:00.000Z","cycle":1,"kind":"enter_review"}]}')
  where id = (select id from heuresis_cards where user_id = '$A' order by created_at, id offset 1 limit 1);
update heuresis_cards set data = data || jsonb_build_object('_acquisition_v1', 'not json at all')
  where id = (select id from heuresis_cards where user_id = '$A' order by created_at, id offset 2 limit 1);
SQL
[ "$($P -d "$DB" -c "select count(*) from pg_tables where tablename like 'heuresis_learn_%'")" = "0" ] || fail "the test database already has Learn tables"
cards="$($P -d "$DB" -c "select count(*) from heuresis_cards")"
events="$($P -d "$DB" -c "select count(*) from heuresis_card_events")"
[ "$cards" -gt 5 ] || fail "the test database has no cards"
pass "a database with $cards cards, $events review events and no Learn tables"

fingerprint() {
  $P -d "$DB" -c "select string_agg(format('%s.%s', schemaname, tablename), ' ' order by schemaname, tablename) from pg_tables
    where schemaname in ('public', 'storage') and tablename not like 'heuresis_learn_%'" | tr ' ' '\n' | while read -r table; do
    [ -n "$table" ] && echo "$table $($P -d "$DB" -c "select count(*) || ':' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from $table t where coalesce(to_jsonb(t)->>'state_kind', '') <> 'learning_phase'")"
  done
  $P -d "$DB" -c "select string_agg(policyname || '@' || tablename, ' ' order by tablename, policyname) from pg_policies where tablename not like 'heuresis_learn_%'"
}
before="$(fingerprint)"
$P -d "$DB" -1 -f "$LEARN" >/dev/null || fail "the Learn migration failed"
after="$(fingerprint)"
[ "$before" = "$after" ] || { diff <(echo "$before") <(echo "$after"); fail "existing data or policies changed"; }
pass "every existing table, row and policy is unchanged ($(echo "$before" | wc -l) tables and the policy list compared)"
[ "$($P -d "$DB" -c "select string_agg(to_state || ':' || origin, ',' order by to_state) from heuresis_card_state_changes where state_kind = 'learning_phase'")" = "learning:backfill,review:backfill" ] \
  || fail "the two cards that had a phase did not each get one starting row in the card history"
pass "cards that already had a phase get one starting row in the card history; the damaged one is skipped"
phases="$($P -d "$DB" -c "select count(*) || ':' || md5(string_agg(s::text, '|' order by s::text)) from heuresis_card_state_changes s where state_kind = 'learning_phase'")"
$P -d "$DB" -1 -f "$LEARN" >/dev/null || fail "running the migration again failed"
[ "$(fingerprint)" = "$before" ] || fail "running it again changed existing data"
[ "$($P -d "$DB" -c "select count(*) || ':' || md5(string_agg(s::text, '|' order by s::text)) from heuresis_card_state_changes s where state_kind = 'learning_phase'")" = "$phases" ] || fail "running it again added history rows"
[ "$($P -d "$DB" -c "select count(*) from pg_tables where tablename like 'heuresis_learn_%'")" = "2" ] || fail "the two Learn tables are missing"
pass "running it a second time changes nothing"

# Card writes after the migration.
bad="$($P -d "$DB" -c "select id from heuresis_cards where data->>'_acquisition_v1' = 'not json at all'")"
$P -d "$DB" -c "update heuresis_cards set data = data || '{\"note\":\"still editable\"}' where id = '$bad'" >/dev/null || fail "a card with a damaged phase value can no longer be saved"
[ "$($P -d "$DB" -c "select count(*) from heuresis_card_state_changes where card_id = '$bad' and state_kind = 'learning_phase'")" = "0" ] || fail "a damaged phase value produced a history row"
learning="$($P -d "$DB" -c "select id from heuresis_cards where data->>'_acquisition_v1' like '%\"phase\":\"learning\"%' limit 1")"
$P -d "$DB" -c "update heuresis_cards set data = data || '{\"note\":\"unrelated edit\"}' where id = '$learning'" >/dev/null
[ "$($P -d "$DB" -c "select count(*) from heuresis_card_state_changes where card_id = '$learning' and state_kind = 'learning_phase'")" = "1" ] || fail "an unrelated edit added a phase row"
$P -d "$DB" -c "update heuresis_cards set data = data || jsonb_build_object('_acquisition_v1', replace(data->>'_acquisition_v1', '\"phase\":\"learning\"', '\"phase\":\"review\"')) where id = '$learning'" >/dev/null
[ "$($P -d "$DB" -c "select from_state || '>' || to_state || ':' || origin from heuresis_card_state_changes where card_id = '$learning' and state_kind = 'learning_phase' order by changed_at desc, id desc limit 1")" = "learning>review:observed" ] \
  || fail "a phase change was not recorded in the card history"
[ "$($P -d "$DB" -c "select count(*) from heuresis_card_events")" = "$events" ] || fail "a phase change created a review event"
pass "cards stay editable (even with a damaged phase value); a phase change is recorded once, and never as a review"

# Ownership and write protection.
$P -d "$DB" -c "insert into auth.users(id) values ('$B') on conflict do nothing" >/dev/null 2>&1 || true
as() { $P -d "$DB" -c "set role authenticated; set request.jwt.claims = '{\"sub\": \"$1\", \"role\": \"authenticated\"}'; $2"; }
plan='[{"n":1},{"n":2},{"n":3},{"n":4},{"n":5}]'
round=aaaaaaaa-0000-4000-8000-0000000000aa
as "$A" "select public.heuresis_learn_begin_round('$round', '$learning', 1, '$plan'::jsonb)" >/dev/null || fail "the owner cannot start a round"
as "$A" "select public.heuresis_learn_record_attempt('$round', 1, 'recognition', 'choose-meaning', true, false, 'a', 'a')" >/dev/null
as "$A" "select public.heuresis_learn_record_attempt('$round', 1, 'recognition', 'choose-meaning', true, false, 'a', 'a')" >/dev/null
[ "$($P -d "$DB" -c "select count(*) || ':' || sum(points) from heuresis_learn_attempts where round_id = '$round'")" = "1:10" ] || fail "the same answer scored twice"
if as "$A" "insert into heuresis_learn_attempts(round_id, position, user_id, card_id, pack_id, stage, exercise_type, correct, points) select '$round', 2, '$A', card_id, pack_id, 'reconstruction', 'x', true, 10 from heuresis_learn_rounds where id = '$round'" >/dev/null 2>&1; then fail "points can be inserted directly"; fi
if as "$A" "update heuresis_learn_rounds set score = 50, ready = true, status = 'completed' where id = '$round'" 2>/dev/null | grep -q .; then :; fi
[ "$($P -d "$DB" -c "select score || ':' || status from heuresis_learn_rounds where id = '$round'")" = "10:active" ] || fail "a round's score can be edited directly"
[ "$(as "$B" "select count(*) from heuresis_learn_rounds")" = "0" ] || fail "another person can see the round"
if as "$B" "select public.heuresis_learn_record_attempt('$round', 2, 'reconstruction', 'x', true, false, '', '')" >/dev/null 2>&1; then fail "another person can answer in the round"; fi
if as "$B" "select public.heuresis_learn_begin_round('aaaaaaaa-0000-4000-8000-0000000000bb', '$learning', 1, '$plan'::jsonb)" >/dev/null 2>&1; then fail "another person can start a round on the card"; fi
pass "one answer per exercise; points and scores cannot be written directly; each person sees and answers only their own rounds"
# Deleting a card removes its Learning rounds with it (no orphans).
$P -d "$DB" -c "delete from heuresis_cards where id = '$learning'" >/dev/null || fail "a card with Learning rounds cannot be deleted"
[ "$($P -d "$DB" -c "select (select count(*) from heuresis_learn_rounds) + (select count(*) from heuresis_learn_attempts)")" = "0" ] || fail "rounds were left behind by a deleted card"
pass "deleting a card removes its Learning rounds"
$P -c "drop database $DB" >/dev/null
echo "Learn migration checks passed."
