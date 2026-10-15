// Offline Notebook edits are revision-guarded; later queued edits of the same
// record are re-based on the revision the server accepted. Browser-level proof:
// verification/tests/regressions.mjs (“offline edits”).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const { revisionFilter, withRevisionFilter, withoutInjectedIds } = loadTs("src/lib/offlineFetch.ts");
const url = "http://localhost:54321/rest/v1/knowledge_records?id=eq.e1&user_id=eq.u1&updated_at=eq.2026-10-15T06%3A22%3A00.165Z&deleted_at=is.null&select=*";
assert.equal(revisionFilter(url), "2026-10-15T06:22:00.165Z");
const rebased = withRevisionFilter(url, "2026-10-15T06:22:05.123456+00:00");
assert.equal(revisionFilter(rebased), "2026-10-15T06:22:05.123456+00:00", "a timezone “+” survives encoding");
const params = new URL(rebased).searchParams;
assert.equal(params.get("id"), "eq.e1");
assert.equal(params.get("deleted_at"), "is.null");
assert.equal(params.get("select"), "*");
assert.equal(revisionFilter("http://x/rest/v1/heuresis_cards?id=eq.1"), null, "unguarded writes are left alone");

const source = readFileSync("src/lib/offlineFetch.ts", "utf8");
assert.match(source, /later\.url = withRevisionFilter\(later\.url, revision\);\s*await putRecord\(QUEUE_STORE, later\);/,
  "the re-based filter is persisted before the next write is sent");
assert.match(source, /queuedRecordKey\(later\) !== key/, "only edits of the same record are re-based");
assert.match(source, /rejected: \{ status: response\.status/, "refused writes are kept and marked, not dropped");
// An offline update must never carry a new client id: replayed, it would try to change
// the row's primary key (browser proof: verification/tests/review-v3.mjs, “offline recovery”).
assert.match(source, /method === "POST" \? addClientIds\(table, parseJson\(rawBody\)\) : parseJson\(rawBody\)/, "client ids are added to inserts only");
assert.match(source, /\{ \.\.\.current, \.\.\.patch, id: current\.id \}/, "a cached row keeps its id when patched offline");
const legacy = { method: "PATCH", url: "http://x/rest/v1/heuresis_cards?id=eq.card-1", body: JSON.stringify({ interest_rank: 5, interesting: true, id: "random-client-id", role: "main" }) };
assert.deepEqual(JSON.parse(withoutInjectedIds(legacy)), { interest_rank: 5, interesting: true }, "an update queued by an earlier version loses its injected id and role");
const insert = { method: "POST", url: "http://x/rest/v1/heuresis_cards", body: JSON.stringify({ id: "new-id", role: "main" }) };
assert.equal(withoutInjectedIds(insert), insert.body, "inserts keep their client ids");
console.log("Offline revision chaining helpers passed.");
