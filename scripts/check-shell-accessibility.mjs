import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const css = readFileSync("src/components/workspace/workspace.css", "utf8");
const chrome = readFileSync("src/theme/chrome.css", "utf8");
const refresh = readFileSync("src/notebook-shell-refresh.css", "utf8");
const subject = readFileSync("src/components/workspace/SubjectCard.tsx", "utf8");

// The approved shell has one visible brand in the top-left, not a second
// sidebar heading. The same epsilon mark is used for every appearance.
assert.match(app, /className="desktop-wordmark"/);
assert.match(app, /className="desktop-brand-mark" aria-hidden="true"><HeuresisMark\s*\/>/);
assert.equal((app.match(/className="desktop-wordmark-name"/g) ?? []).length, 1);
assert.doesNotMatch(app, /className="hw-sidebar-brand"/);
assert.doesNotMatch(app, /className="desktop-mark-wrap"><HeuresisMark/);
assert.match(app, /className="desktop-action hw-sidebar-header-toggle"/);
assert.match(chrome, /height: 48px/);
assert.match(css, /top: 48px/);
assert.match(css, /100dvh - 48px/);
assert.match(refresh, /data-sidebar="rail"\] \.hw-sections button/);
assert.match(refresh, /\.nb-subject-icon/);
assert.match(subject, /chinese: "#d9828f", german: "#70a8dc", russian: "#82c49a"/);
assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
assert.match(css, /animation: ws-page-enter \.17s ease-out backwards/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(css, /\.heuresis-desktop :is\(button, a, input, textarea, select, summary, \[role="tab"\]\):focus-visible/);
assert.match(css, /@media \(forced-colors: active\)/);
console.log("Single branded header, sidebar controls, language cards, motion and accessible focus checks passed.");
