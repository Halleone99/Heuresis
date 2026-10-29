import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const overview = readFileSync("src/components/workspace/OverviewView.tsx", "utf8");
const activity = readFileSync("src/lib/activity.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/components/workspace/overview-heatmap.css", "utf8");

assert.match(overview, /Last 26 weeks/);
assert.match(overview, /By topic/);
assert.match(overview, /onOpenTopic\(pack\)/);
assert.match(overview, /setSelectedId/);
assert.match(overview, /review\.card_id/);
assert.match(overview, /summarise\(selected \? reviews\.filter/);
assert.match(overview, /Loading study activity/);
assert.match(overview, /Study history is unavailable/);
assert.match(overview, /historyReady \? \(stats\?\.cards \?\? 0\)/);
assert.match(activity, /pack_id,card_id,session_id/);
assert.match(app, /<OverviewView collections=\{collections\} packs=\{packs\}/);
for (const unwanted of ["Notes to revisit", "Browse subjects", "ov-quicklinks", "loadPersonalOsAnkiDays", "NotebookPen", "GOAL_PREFIX"]) {
  assert.ok(!overview.includes(unwanted), "Overview should not include " + unwanted);
}
assert.match(css, /\.oh-topic-weeks/);
assert.match(css, /\.oh-calendar-scroll/);
assert.ok(!app.includes("<ProgressView"));
console.log("Study-only Overview heatmap, per-topic counts and navigation: OK");
