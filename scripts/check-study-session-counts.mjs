import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/activity.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", "require", js)(module, module.exports, () => ({ supabase: null }));

const filter = module.exports.meaningfulStudySessions;
const makeSession = (id, cards_encountered) => ({
  id, cards_encountered, started_at: "2026-10-14T12:00:00Z", ended_at: null, mode: "flashcards", pack_id: "topic-1",
});
const sessions = [
  makeSession("empty", 0),
  makeSession("graded", 0),
  makeSession("browse", 2),
  makeSession("null-count", null),
  makeSession("graded-browse", 3),
];
const reviews = [
  { session_id: "graded", event_type: "good", created_at: "2026-10-14T12:02:00Z", pack_id: "topic-1" },
  { session_id: "graded-browse", event_type: "hard", created_at: "2026-10-14T12:03:00Z", pack_id: "topic-1" },
  { session_id: null, event_type: "easy", created_at: "2026-10-14T12:04:00Z", pack_id: "topic-1" },
];

assert.deepEqual(filter(sessions, reviews).map((session) => session.id),
  ["graded", "browse", "graded-browse"]);
assert.deepEqual(filter(sessions, []).map((session) => session.id),
  ["browse", "graded-browse"]);
assert.deepEqual(filter([], reviews), []);
assert.ok(source.includes('select("event_type,created_at,pack_id,session_id")'),
  "The review query must retrieve session_id to associate graded events");
const progress = readFileSync("src/components/workspace/ProgressView.tsx", "utf8");
assert.ok(progress.includes("meaningfulStudySessions(activity?.sessions ?? [], reviews)"),
  "Progress must use filtered non-empty sessions");
console.log("Study session evidence checks passed.");
