#!/usr/bin/env bash
# Runs every suite against fresh database copies. Needs setup.sh, the gateway and the Vite dev server.
cd "$(dirname "$0")"
run() { echo "=== $1 ($2)"; ./db.sh restore "$2" >/dev/null; node "tests/$1" 2>&1 | grep -E "✓|✗|Error"; }
./db.sh restore heuresis_v2_baseline >/dev/null
echo "=== e2e1.mjs: workflows 1–10"; node tests/e2e1.mjs 2>&1 | grep -E "✓|✗|Error"
echo "=== e2e2.mjs: workflows 11–17 (continues e2e1)"; node tests/e2e2.mjs 2>&1 | grep -E "✓|✗|Error"
run e2e3.mjs heuresis_showcase
run e2e4.mjs heuresis_showcase
run e2e5.mjs heuresis_showcase
run e2e6.mjs heuresis_showcase
./db.sh restore heuresis_v1_baseline >/dev/null
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-54329}" -U postgres -d heuresis -q -f sql/30_v1_rows.sql
echo "=== v1mode.mjs: before the v2 migration"; node tests/v1mode.mjs 2>&1 | grep -E "✓|✗|Error"
echo "=== format.mjs: Markdown ⇄ editor round trip"; node tests/format.mjs 2>&1 | grep -E "exact|stable" | sort | uniq -c
