#!/usr/bin/env bash
# db.sh snapshot <name> | restore <name> — copies the test database while PostgREST is stopped.
set -e
cd "$(dirname "$0")"
PGHOST="${PGHOST:-/tmp}"; PGPORT="${PGPORT:-54329}"
P="psql -h $PGHOST -p $PGPORT -U postgres -q"
[ -f postgrest.pid ] && kill "$(cat postgrest.pid)" 2>/dev/null || true
sleep 0.5
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('heuresis','$2') and pid <> pg_backend_pid()" >/dev/null
if [ "$1" = "snapshot" ]; then $P -c "drop database if exists $2" && $P -c "create database $2 template heuresis"; fi
if [ "$1" = "restore" ]; then $P -c "drop database if exists heuresis" && $P -c "create database heuresis template $2"; fi
sed "s#localhost:54329/heuresis?host=/tmp#localhost:$PGPORT/heuresis?host=$PGHOST#" postgrest.conf > .postgrest.local.conf
nohup ./postgrest .postgrest.local.conf > postgrest.log 2>&1 & echo $! > postgrest.pid
sleep 1
