import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const overview = readFileSync("src/components/workspace/OverviewView.tsx", "utf8");
const activity = readFileSync("src/lib/activity.ts", "utf8");
const reading = readFileSync("src/lib/readingBridge.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/components/workspace/overview-heatmap.css", "utf8");

for (const label of ["Flashcards", "Notes", "Reading", "Articles"]) {
  assert.match(overview, new RegExp('label: "' + label + '"'), label + " activity option is present");
  assert.match(overview, new RegExp('>' + label + '</strong>'), label + " dashboard card is present");
}
assert.match(overview, /Last 26 weeks/);
assert.match(overview, /onChange=\{\(event\) => setKind/);
assert.match(overview, /loadStudyInventory/);
assert.match(overview, /loadStudyActivity/);
assert.match(overview, /role="img"/);
assert.match(overview, /bookReadingDays/);
assert.match(overview, /catalogue_articles/);
assert.match(overview, /workspace\.snapshot\.entries\.filter\(\(entry\) => entry\.kind === "note"\)/);
assert.match(overview, /Published \(30 d\)/);
assert.doesNotMatch(overview, /articles.*read \(30 d\)/i, "Article reading is not recorded");
assert.match(overview, /onClick=\{navigation\.flashcards\}/);
assert.match(overview, /onClick=\{navigation\.notes\}/);
assert.match(overview, /onClick=\{navigation\.reading\}/);
assert.match(overview, /onClick=\{navigation\.articles\}/);
assert.match(overview, /activityLoading \|\| inventoryLoading/);
assert.match(overview, /No reading logged/);
assert.match(activity, /pack_id,card_id,session_id/);
assert.match(reading, /export function bookReadingDays/);
assert.match(app, /<OverviewView packs=\{packs\} studyLoading=\{loading\}/);
assert.match(css, /\.oh-dashboard-cards/);
assert.match(css, /\.oh-select/);
assert.match(css, /\.oh-calendar-scroll/);
assert.match(css, /\.oh-recent-panel/);
assert.ok(!app.includes("<ProgressView"));
console.log("Library Overview four sections, navigation, and activity selector: OK");
