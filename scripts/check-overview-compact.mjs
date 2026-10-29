import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const overview = readFileSync("src/components/workspace/OverviewView.tsx", "utf8");
const activity = readFileSync("src/lib/activity.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/components/workspace/overview-heatmap.css", "utf8");

assert.match(overview, /Last 26 weeks/);
assert.match(overview, /Choose a Study topic/);
assert.match(overview, /30-day review coverage/);
assert.match(overview, /Added in 30 days/);
assert.match(overview, /Reviewed in 30 days/);
assert.match(overview, /onOpenTopic\(selected\)/);
assert.match(overview, /setTopicId/);
assert.match(overview, /review\.card_id/);
assert.match(overview, /loadStudyInventory/);
assert.match(overview, /summary\(relevant\)/);
assert.match(overview, /Loading study statistics/);
assert.match(overview, /Review history unavailable/);
assert.match(overview, /historyReady \? month\.unique/);
assert.match(activity, /pack_id,card_id,session_id/);
assert.match(app, /<OverviewView collections=\{collections\} packs=\{packs\}/);
for (const unwanted of ["Notes to revisit", "Browse subjects", "ov-quicklinks", "loadPersonalOsAnkiDays", "NotebookPen", "GOAL_PREFIX"]) {
  assert.ok(!overview.includes(unwanted), "Overview should not include " + unwanted);
}
assert.match(css, /\.oh-metrics/);
assert.match(css, /\.oh-select/);
assert.match(css, /\.oh-calendar-scroll/);
assert.ok(!app.includes("<ProgressView"));
console.log("Study-only Overview heatmap, per-topic counts and navigation: OK");
