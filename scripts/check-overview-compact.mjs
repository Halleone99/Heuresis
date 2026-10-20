import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const overview = readFileSync("src/components/workspace/OverviewView.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const reading = readFileSync("src/components/workspace/ReadingView.tsx", "utf8");
const memory = readFileSync("src/lib/workspaceMemory.ts", "utf8");
const css = readFileSync("src/components/workspace/workspace.css", "utf8");

assert.match(overview, /PERSONAL KNOWLEDGE LIBRARY/);
assert.match(overview, /Notes to revisit/);
assert.match(overview, /entry\.description\.trim\(\)/, "Overview previews should use the saved note description");
assert.match(overview, /Filter notes by subject/);
assert.match(overview, /openSubject\(subject.id\)/);
const subjectHandler = overview.slice(overview.indexOf("function openSubject"), overview.indexOf("return <div className="));
assert.ok(subjectHandler.indexOf('workspace.goTo("notebook")') < subjectHandler.indexOf("workspace.updateMemory("),
  "Subject navigation must set the Notebook location after its home reset");
for (const unwanted of ["ActivityHeatmap", "loadStudyActivity", "loadPersonalOsAnkiDays", "Learning activity", "View progress", "Objectives", "saveGoal", "GOAL_PREFIX"]) {
  assert.ok(!overview.includes(unwanted), "Overview should not track " + unwanted);
}
assert.match(css, /\.ov-library-subjects/);
assert.match(app, /<OverviewView onOpenStudy/);
assert.ok(!app.includes("<ProgressView"));
assert.ok(!app.includes('id: "progress"'));
assert.ok(!reading.includes("Log time"));
assert.ok(!reading.includes("logged reading"));
assert.ok(!reading.includes("bookMinutes"));
assert.match(reading, /<ReadingJournal/);
assert.match(reading, /Page progress/);
assert.ok(!memory.includes('stored === "progress"'));
console.log("Knowledge-first Overview, subject browsing, reading journal and hidden tracking: OK");
