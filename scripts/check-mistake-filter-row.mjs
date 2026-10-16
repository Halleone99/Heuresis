// Simple regression guard: the Mistake Log is now a two-field, subject-neutral list.
// Historical records and externally launched recall remain supported.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/components/workspace/MistakeLog.tsx", "utf8");
const quick = readFileSync("src/components/workspace/QuickCapture.tsx", "utf8");
const css = readFileSync("src/components/workspace/workspace.css", "utf8");

assert.match(page, /export function MistakeLog\(\)/);
assert.match(page, /snapshot\.entries[\s\S]*entry\.kind === "mistake"/);
assert.match(page, /<span className="ml-simple-label">Mistake<\/span>/);
assert.match(page, /<span className="ml-simple-label">Correction<\/span>/);
assert.match(page, /workspace\.addSubject\("Unsorted"\)/);
assert.match(page, /await workspace\.patchEntry\(entry\.id, \{ attempt:/);
assert.match(page, /function RecallSession\(/);
assert.doesNotMatch(page, /ml-mode-grid|ml-languages-tabs|ml-filter-row|ml-stage|Complete history|New mode|Practise due/);
assert.match(quick, /mode === "mistake" \? <>[\s\S]*<span>Mistake<\/span>[\s\S]*<span>Correction<\/span>/);
assert.doesNotMatch(quick, /Type of mistake|Add why|What I said or wrote/);
assert.match(css, /\.ml-simple-item/);
console.log("Minimal subject-neutral Mistake Log checks passed.");
