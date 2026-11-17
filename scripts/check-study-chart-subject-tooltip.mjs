import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Exercise the real activity aggregation, not a reimplementation of the math.
const source = readFileSync("src/lib/studyActivity.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, () => ({ supabase: null }));
const { aggregateStudyActivity } = mod.exports;
const days = [new Date(2026, 10, 16), new Date(2026, 10, 17)];
const rows = [
  { day: "2026-11-16", pack_id: "de", new_cards: 2, exercises: 1, reviews: 0 },
  { day: "2026-11-16", pack_id: "ru", new_cards: 3, exercises: 0, reviews: 2 },
  { day: "2026-11-16", pack_id: "zh", new_cards: 2, exercises: 0, reviews: 0 },
  { day: "2026-11-17", pack_id: "zh", new_cards: 0, exercises: 4, reviews: 1 },
  { day: "2026-11-15", pack_id: "de", new_cards: 99, exercises: 0, reviews: 0 },
];
const activity = aggregateStudyActivity(days, rows);
assert.deepEqual(activity.new, [7, 0]);
assert.deepEqual(activity.learn, [1, 4]);
assert.deepEqual(activity.review, [2, 1]);
assert.deepEqual(["de", "ru", "zh"].map((id) => activity.byPack[id].new[0]), [2, 3, 2]);
for (const stage of ["new", "learn", "review"]) for (let day = 0; day < 2; day++) {
  assert.equal(activity[stage][day],
    Object.values(activity.byPack).reduce((n, pack) => n + pack[stage][day], 0));
}
const partial = aggregateStudyActivity(days, [
  { day: "2026-11-16", pack_id: null, new_cards: 1, exercises: 0, reviews: 0 },
]);
assert.equal(partial.new[0], 1, "Missing pack attribution must not erase totals");
assert.deepEqual(partial.byPack, {}, "Missing attribution must never invent a language");

const component = readFileSync("src/components/TodayStudyPanel.tsx", "utf8");
const css = readFileSync("src/study-home.css", "utf8");
const migration = readFileSync("supabase/migrations/20261116133000_heuresis_study_activity_cards.sql", "utf8");
assert.match(migration, /day date, pack_id uuid, new_cards int, exercises int, reviews int/);
assert.match(component, /const chartBreakdowns = days\.map/);
assert.match(component, /activity\?\.byPack\[pack\.id\]/);
assert.match(component, /collectionNames\.get\(pack\.collection_id\)/);
assert.match(component, /className="sh-chart-tooltip" role="tooltip"/);
assert.match(component, /tabIndex=\{0\}/);
assert.match(css, /\.sh-chart-column:is\(:hover,:focus\) \.sh-chart-tooltip/);
console.log("Study chart per-language tooltip counts and hover styles passed.");
