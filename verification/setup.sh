#!/usr/bin/env bash
# Builds a local, Supabase-shaped test backend from this repository's migrations:
#   PostgreSQL (socket in $PGHOST, port $PGPORT) + PostgREST 12 + an auth/REST gateway.
# Requirements: PostgreSQL 15+ server binaries (initdb, pg_ctl, psql), a PostgREST 12 binary
# at ./postgrest (https://github.com/PostgREST/postgrest/releases), Node 20+.
# Nothing here touches the real Supabase project.
set -euo pipefail
cd "$(dirname "$0")"
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-54329}"
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
P="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"

if [ ! -d pgdata ]; then "$PGBIN/initdb" -D pgdata -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null; fi
"$PGBIN/pg_ctl" -D pgdata -o "-p $PGPORT -k $PGHOST" -l pg.log status >/dev/null 2>&1 || "$PGBIN/pg_ctl" -D pgdata -o "-p $PGPORT -k $PGHOST" -l pg.log start
sleep 1

[ -f postgrest.pid ] && kill "$(cat postgrest.pid)" 2>/dev/null || true
sleep 0.5
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname like 'heuresis%' and pid <> pg_backend_pid()" >/dev/null
for db in heuresis heuresis_v1_baseline heuresis_v2_baseline heuresis_showcase; do $P -c "drop database if exists $db"; done
$P -c "create database heuresis"
$P -d heuresis -f sql/00_supabase_stub.sql
V2=20261012090000_knowledge_workspace_v2.sql
# Migrations dated before v2 form the v1 baseline. v2 and every later migration are
# applied afterwards, in filename order (later files depend on the v2 tables).
LATER=()
for f in ../supabase/migrations/*.sql; do
  if [[ "$(basename "$f")" < "$V2" ]]; then
    $P -d heuresis -1 -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; exit 1; }
  else
    LATER+=("$f")
  fi
done
$P -d heuresis -1 -f sql/10_seed.sql
$P -c "create database heuresis_v1_baseline template heuresis"
for f in "${LATER[@]}"; do
  $P -d heuresis -1 -f "$f" >/dev/null 2>&1 || { echo "migration failed: $f"; exit 1; }
done
$P -d heuresis -1 -f "../supabase/migrations/$V2" >/dev/null 2>&1   # idempotency: a second run must succeed
$P -c "create database heuresis_v2_baseline template heuresis"
$P -d heuresis -f sql/20_showcase.sql
$P -c "create database heuresis_showcase template heuresis"
./db.sh restore heuresis_v2_baseline
echo "Backend ready. Start the gateway (node gateway.mjs) and the app with:"
echo "  VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 1421"
