// A mistake still requires only two fields; optional organisation and styling are available.
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
assert.match(page, /workspace\.patchEntry\(entry\.id, \{[\s\S]*attempt:/);
assert.match(page, /workspace\.addSubject\(name\)/);
assert.match(page, /workspace\.addTopic\(creatingTopic\.subjectId, name, creatingTopic\.parentId\)/);
assert.match(page, /workspace\.changeTopic\(topic\.id, \{ name \}\)/);
assert.match(page, /accent_color: accent \|\| null/);
assert.match(page, /title: title\.trim\(\)/);
assert.match(page, /data-accent=\{entry\.accent_color \?\? "none"\}/);
assert.match(page, /selectedTopicId[\s\S]*subtreeIds/);
const model = readFileSync("src/lib/knowledgeWorkspace.ts", "utf8");
assert.match(model, /export type MistakeAccent/);
assert.match(model, /accent_color: MistakeAccent \| null/);
assert.match(css, /\.ml-organised-layout/);
assert.match(css, /\.ml-accent-choice/);
assert.match(page, /function RecallSession\(/);
assert.doesNotMatch(page, /ml-mode-grid|ml-languages-tabs|ml-filter-row|ml-stage|Complete history|New mode|Practise due/);
assert.match(quick, /mode === "mistake" \? <>[\s\S]*<span>Mistake<\/span>[\s\S]*<span>Correction<\/span>/);
assert.doesNotMatch(quick, /Type of mistake|Add why|What I said or wrote/);
assert.match(css, /\.ml-simple-item/);
console.log("Mistake Log organisation, editing and colour regression checks passed.");
