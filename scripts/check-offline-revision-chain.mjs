// Offline Notebook edits are revision-guarded; later queued edits of the same
// record are re-based on the revision the server accepted. Browser-level proof:
// verification/tests/regressions.mjs (“offline edits”).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const { revisionFilter, withRevisionFilter } = loadTs("src/lib/offlineFetch.ts");
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
console.log("Offline revision chaining helpers passed.");
