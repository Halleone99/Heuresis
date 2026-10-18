import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync("src/components/workspace/workspace.css", "utf8");
const overview = readFileSync("src/components/workspace/OverviewView.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

for (const removed of ["Recent lessons", "Questions to clarify", "earlier captures in Personal OS", "Start a lesson", "Mistake Log →", "ov-legacy", "ov-figures"]) {
  assert.ok(!overview.includes(removed), `Overview still contains obsolete section: ${removed}`);
}
assert.match(overview, /loadStudyActivity\(workspace\.userId, 190/);
assert.match(overview, /meaningfulStudySessions/);
assert.match(overview, /activity\.reviews/);
assert.match(overview, /snapshot\.practice/);
assert.match(overview, /future: key > today/);
assert.match(overview, /data-level=\{day\.future/);
assert.match(overview, /aria-label="Filter Overview by language"/);
assert.match(overview, /const notes = snapshot\.entries\.filter/);
assert.match(overview, /keyOfName\(workspace\.subjectById/);
assert.match(overview, /GOAL_PREFIX \+ workspace\.userId/);
assert.match(overview, /saveGoal\(selected, draft\)/);
assert.match(overview, /workspace\.goTo\("progress"\)/);
assert.match(css, /\.ov-heat-grid\{display:grid;/);
assert.match(css, /\.ov-simple-grid\{display:grid;/);
assert.match(app, /<OverviewView study=\{studySummary\} onOpenStudy=\{\(\) => navigateSection\("study"\)\} collections=\{collections\} packs=\{packs\}/);
assert.match(app, /SECTIONS\.filter\(\(item\) => item\.id !== "progress"\)/);
console.log("Simple Overview structure, heatmap sources, filtering, goals and Progress navigation passed.");
