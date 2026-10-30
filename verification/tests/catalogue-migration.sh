#!/usr/bin/env bash
# Applies the Catalogue migration to a database that holds Notebook, Study and other
# data but not yet the Catalogue, then proves that:
#   - every existing table (and Storage) is byte-for-byte unchanged;
#   - running the migration a second time changes nothing;
#   - a person can see and change only their own Catalogue rows and images.
# Needs the harness from setup.sh (PostgreSQL on $PGHOST:$PGPORT). Leaves the test
# databases as they were.
set -euo pipefail
cd "$(dirname "$0")/.."
PGHOST="${PGHOST:-/tmp}"; PGPORT="${PGPORT:-54329}"
export PGOPTIONS="-c client_min_messages=warning"
P="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q -At"
DB=heuresis_catalogue_migration
CATALOGUE=../supabase/migrations/20261030090000_catalogue_publications.sql
V2=20261012090000_knowledge_workspace_v2.sql
fail() { echo "✗ $1"; exit 1; }
pass() { echo "  ✓ $1"; }

echo "— Catalogue migration on existing data"
$P -c "drop database if exists $DB" >/dev/null
$P -c "create database $DB template heuresis_v1_baseline"
for f in ../supabase/migrations/*.sql; do
  name="$(basename "$f")"
  [[ "$name" < "$V2" ]] && continue
  [[ "$name" == "$(basename "$CATALOGUE")" ]] && continue
  $P -d "$DB" -1 -f "$f" >/dev/null 2>&1 || fail "migration failed: $name"
done
$P -d "$DB" -f sql/20_showcase.sql >/dev/null
[ "$($P -d "$DB" -c "select count(*) from pg_tables where tablename like 'catalogue_%'")" = "0" ] || fail "the test database already has Catalogue tables"
notes="$($P -d "$DB" -c "select count(*) from knowledge_records")"
[ "$notes" -gt 5 ] || fail "the test database has no Notebook notes"
pass "a database with $notes Notebook notes and no Catalogue"

fingerprint() {
  $P -d "$DB" -c "select string_agg(format('%s.%s', schemaname, tablename), ' ' order by schemaname, tablename) from pg_tables
    where schemaname in ('public', 'storage') and tablename not like 'catalogue_%'" | tr ' ' '\n' | while read -r table; do
    [ -n "$table" ] && echo "$table $($P -d "$DB" -c "select count(*) || ':' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from $table t where not (to_jsonb(t) ? 'bucket_id' and to_jsonb(t)->>'bucket_id' = 'heuresis-catalogue-media') and not ('$table' = 'storage.buckets' and to_jsonb(t)->>'id' = 'heuresis-catalogue-media')")"
  done
  $P -d "$DB" -c "select string_agg(policyname || '@' || tablename, ' ' order by tablename, policyname) from pg_policies where tablename not like 'catalogue_%' and policyname not like 'heuresis_catalogue_media%'"
}
before="$(fingerprint)"
$P -d "$DB" -1 -f "$CATALOGUE" >/dev/null || fail "the Catalogue migration failed"
after="$(fingerprint)"
[ "$before" = "$after" ] || { diff <(echo "$before") <(echo "$after"); fail "existing data or policies changed"; }
pass "every existing table, row and policy is unchanged ($(echo "$before" | wc -l) tables and the policy list compared)"
$P -d "$DB" -1 -f "$CATALOGUE" >/dev/null || fail "running the migration again failed"
[ "$(fingerprint)" = "$before" ] || fail "running it again changed existing data"
[ "$($P -d "$DB" -c "select count(*) from pg_tables where tablename like 'catalogue_%'")" = "3" ] || fail "the three Catalogue tables are missing"
pass "running it a second time changes nothing"

A=11111111-1111-4111-8111-111111111111
B=22222222-2222-4222-8222-222222222222
$P -d "$DB" -c "insert into auth.users(id) values ('$B') on conflict do nothing" >/dev/null 2>&1 || true
as() { $P -d "$DB" -c "set role authenticated; set request.jwt.claims = '{\"sub\": \"$1\", \"role\": \"authenticated\"}'; $2"; }
as "$A" "insert into catalogue_articles(id, user_id, title) values ('aaaaaaaa-0000-4000-8000-000000000001', '$A', 'Mine')" >/dev/null
[ "$(as "$A" "select count(*) from catalogue_articles")" = "1" ] || fail "the owner cannot see the article"
[ "$(as "$B" "select count(*) from catalogue_articles")" = "0" ] || fail "another person can see the article"
as "$B" "update catalogue_articles set title = 'Taken' where id = 'aaaaaaaa-0000-4000-8000-000000000001'" >/dev/null
[ "$($P -d "$DB" -c "select title from catalogue_articles where id = 'aaaaaaaa-0000-4000-8000-000000000001'")" = "Mine" ] || fail "another person changed the article"
as "$A" "update catalogue_articles set user_id = '$B' where id = 'aaaaaaaa-0000-4000-8000-000000000001'" >/dev/null 2>&1 && fail "the owner column can be changed" || true
if as "$B" "insert into catalogue_articles(user_id, title) values ('$A', 'Forged')" >/dev/null 2>&1; then fail "an article can be created for someone else"; fi
pass "each person sees and changes only their own articles; ownership cannot be moved or forged"
# Supabase grants these on storage.objects; the local stand-in schema does not.
$P -d "$DB" -c "grant select, insert, update, delete on storage.objects to authenticated" >/dev/null
if as "$B" "insert into storage.objects(bucket_id, name, owner) values ('heuresis-catalogue-media', '$A/x.png', '$B')" >/dev/null 2>&1; then fail "an image can be stored in someone else's folder"; fi
as "$A" "insert into storage.objects(bucket_id, name, owner) values ('heuresis-catalogue-media', '$A/x.png', '$A')" >/dev/null || fail "the owner cannot store an image in their folder"
[ "$(as "$B" "select count(*) from storage.objects where bucket_id = 'heuresis-catalogue-media'")" = "0" ] || fail "another person can see the image"
pass "images are confined to the owner's folder"
$P -c "drop database $DB" >/dev/null
echo "Catalogue migration checks passed."
