import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/mistakeJourney.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", js)(mod, mod.exports);
const { mistakeJourney, MISTAKE_MILESTONES } = mod.exports;

const mon = (date) => new Date(date + "T12:00:00");
const start = (date) => { const d=mon(date); d.setHours(0,0,0,0); return d; };
const weeks = ["2026-10-05", "2026-10-12", "2026-10-19"].map(date => {
  const d=start(date); return { start:d, key:d.toISOString(), value:0 };
});
const mistake = id => ({ id, kind:"mistake", created_at:"2026-10-06T10:00:00", recall_streak:0 });
const event = (id, record_id, date, outcome) => ({id,record_id,created_at:date,outcome,answer:""});
const entries = [mistake("one"),mistake("two")];
const history=[
  event("a","one","2026-10-06T09:00:00","correct"),
  event("b","one","2026-10-06T09:10:00","correct"),
  event("c","one","2026-10-13T09:00:00","correct"),
  event("d","one","2026-10-14T09:00:00","correct"),
  event("e","two","2026-10-07T09:00:00","correct"),
  event("f","two","2026-10-08T09:00:00","incorrect"),
  event("g","two","2026-10-09T09:00:00","correct"),
  event("h","two","2026-10-10T09:00:00","correct"),
  event("i","two","2026-10-15T09:00:00","correct"),
  event("j","other","2026-10-13T09:00:00","correct"),
  event("k","one","bad-date","correct"),
];
const result=mistakeJourney(weeks,entries,history);
assert.deepEqual(MISTAKE_MILESTONES.map(row=>row.name),
  ["Logged","First recalled","Three-day milestone"]);
assert.equal(result.firstCorrectCount,2);
assert.equal(result.achievedThreeDays,2);
assert.deepEqual(result.weeks.map(w=>w.segments.logged||0),[2,0,0]);
assert.deepEqual(result.weeks.map(w=>w.segments.first_correct||0),[2,0,0]);
assert.deepEqual(result.weeks.map(w=>w.segments.three_days||0),[0,2,0]);
assert.deepEqual(result.weeks.map(w=>w.value),[4,2,0]);
for (const row of result.weeks) {
  assert.equal(row.value, Object.values(row.segments).reduce((a,b)=>a+b,0),
    "All stack totals must agree with the weekly bar");
}
const noFalseMilestone=mistakeJourney(weeks,[mistake("one")],[
  event("x","one","2026-10-06T09:00:00","correct"),
  event("y","one","2026-10-06T10:00:00","correct"),
  event("z","one","2026-10-06T12:00:00","correct"),
]);
assert.equal(noFalseMilestone.achievedThreeDays,0, "Repeated same-day recalls count only once");
const missed=mistakeJourney(weeks,[mistake("one")],[
  event("x","one","2026-10-06T09:00:00","correct"),
  event("y","one","2026-10-07T09:00:00","correct"),
  event("z","one","2026-10-08T09:00:00","incorrect"),
  event("a","one","2026-10-09T09:00:00","correct"),
]);
assert.equal(missed.achievedThreeDays,0, "A wrong recall resets the three-day streak");
const early=mistakeJourney(weeks,[mistake("one")],[
  event("x","one","2026-09-25T09:00:00","correct"),
  event("y","one","2026-09-29T09:00:00","correct"),
  event("z","one","2026-10-06T09:00:00","correct"),
]);
assert.equal(early.weeks[0].segments.three_days,1, "Older days still count towards this week's milestone");
assert.equal(early.weeks[0].segments.first_correct||0,0, "The first correct happened before chart period");
const page = readFileSync("src/components/workspace/ProgressView.tsx","utf8");
assert.match(page,/title="Mistake learning milestones"/);
assert.match(page,/seriesLabel="milestone"/);
assert.match(page,/const journey = useMemo\(\(\) => mistakeJourney\(weeks, mistakes, snapshot\.practice\)/);
assert.match(page,/journey\.firstCorrectCount/);
assert.match(page,/journey\.achievedThreeDays/);
assert.doesNotMatch(page,/stageCount\("practising"\)/);
assert.match(page,/snapshot\.practiceError \? <p className="ws-muted">/);
console.log("Mistake milestones: repeated days, resets, historical events and UI checks passed.");
