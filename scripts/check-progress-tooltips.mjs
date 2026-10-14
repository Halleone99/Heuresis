import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = readFileSync("src/components/workspace/ProgressView.tsx", "utf8");
const css = readFileSync("src/components/workspace/workspace.css", "utf8");

assert.match(page, /className="pg-total-period">· \{weeks\.length\} wk/);
assert.match(page, /tooltipLeft = hover === null \? 50 : Math\.max\(17, Math\.min\(83/);
assert.match(page, /role="tooltip" style=\{\{ left: `\$\{tooltipLeft\}%` \}\}/);
assert.match(css, /\.pg-tip \{ position: absolute; top: 6px; bottom: auto;/);
assert.doesNotMatch(css, /\.pg-tip \{ position: absolute; bottom: calc\(100% - 4px\)/);
for (const weeks of [8, 12, 26]) for (const i of [0, 1, weeks - 2, weeks - 1]) {
  const left = Math.max(17, Math.min(83, ((i + .5) / weeks) * 100));
  assert.ok(left >= 17 && left <= 83);
}
console.log("Progress period labels and contained tooltips passed.");
