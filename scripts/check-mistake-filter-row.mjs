// Mistake Log regression contract: a single card view, Study integration, capture safety.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(path, "utf8");
const page = read("src/components/workspace/MistakeLog.tsx");
const css = read("src/components/workspace/mistake-cards.css");
const coreCss = read("src/components/workspace/workspace.css");
const hook = read("src/components/workspace/useStudyMistakes.ts");
const memory = read("src/lib/workspaceMemory.ts");
const migration = read("supabase/migrations/20261116165000_heuresis_review_mistake_resolution.sql");
const context = read("src/components/workspace/WorkspaceContext.tsx");
const notebook = read("src/components/workspace/NotebookView.tsx");
const knowledge = read("src/lib/knowledgeWorkspace.ts");
const capture = read("src/components/workspace/QuickCapture.tsx");
const diff = read("src/lib/mistakeDiff.ts");

// The old hierarchy and theme selection must not be rendered alongside cards.
assert.match(page, /export function MistakeLog\(\)/);
assert.match(page, /function FlippingCard\(/);
assert.match(page, /className="hc-grid"/);
assert.match(page, /className="hc-head"/);
assert.match(page, /className="hc-filters"/);
assert.match(page, /function CardFilter\(/);
assert.match(page, /function AddMistakeTile\(/);
assert.doesNotMatch(page, /ml-theme-gallery|ml-hierarchy-grid|ml-study-selection|Browse all corrections|Choose a subject, then select/);

// One exact filtered list drives both card display and recall.
assert.match(page, /const filtered = bySubject\.filter/);
assert.match(page, /visibleLogged = filtered\.filter/);
assert.match(page, /onClick=\{\(\) => startPractice\(visibleLogged\)\}/);
assert.match(page, /Practise \{visibleLogged\.length\}/);
assert.match(page, /onClick=\{clearFilters\}/);
assert.match(page, /const subjectMap = new Map/);
assert.match(page, /normalise\(item\.subject\)/);
assert.match(page, /aria-pressed=\{selecting \? selected : flipped\}/);
assert.match(page, /event\.key === "Enter" \|\| event\.key === " "/);
assert.match(css, /\.hc-card\.is-flipped/);
assert.match(css, /grid-area:1\/1/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /max-width:900px/);
assert.match(css, /max-width:560px/);

// Study errors are isolated from Notebook; one item per card despite two directions.
assert.match(page, /useStudyMistakes\(\)/);
assert.match(page, /Review these \{filtered\.length\} in Study/);
assert.match(page, /createReviewRoute\(entries\)/);
assert.match(page, /onLog=\{\(\) =>/);
assert.match(hook, /grouped = new Map<string, LinkedMistake\[\]>/);
assert.match(hook, /\.is\("resolved_at", null\)/);
assert.match(hook, /db\.from\("heuresis_collections"\)/);
assert.match(hook, /window\.addEventListener\("focus"/);
assert.match(migration, /add column if not exists resolved_at/);
assert.match(migration, /new\.event_type in \('good', 'easy'\)/);
assert.match(migration, /new\.created_at > m\.last_wrong_at/);
assert.match(migration, /is not distinct from/);
assert.match(migration, /with last_grade as/);

// Capture, duplicate handling, rich editor, select + undo, foreign links, and IME safety remain.
assert.match(page, /findRepeatedMistake\(/);
assert.match(page, /workspace\.recordRepeated\(/);
assert.match(page, /function MistakeBulkAdd\(/);
assert.match(page, /<TopicPicker value=\{topicId \|\| null\}/);
assert.match(page, /function MistakeEditor\(/);
assert.match(page, /<RichEditor ref=\{explanationRef\}/);
assert.match(page, /function RecallSession\(/);
assert.match(page, /<MistakeDisplay parts=\{diff\.before\}/);
assert.match(page, /<MistakeDisplay parts=\{diff\.after\}/);
assert.match(page, /<RichText text=\{entry\.explanation\}/);
assert.match(page, /action: \{ label: "Undo"/);
assert.match(page, /focusMistake/);
assert.match(page, /event\.nativeEvent\.isComposing \|\| event\.nativeEvent\.keyCode === 229/);
assert.match(memory, /mistakes: \{ subjectId: string \| null; topicId: string \| null; status:/);
assert.match(memory, /stored\.mistakes/);
assert.match(page, /workspace\.updateMemory/);

// Existing Notebook mutations and visual diff semantics must not regress.
assert.match(diff, /function refineSingleWord/);
assert.match(diff, /kind: "gap"/);
assert.match(coreCss, /\.ml-diff-gap/);
assert.match(context, /const removeTopic = useCallback[\s\S]*deletedEntryIds[\s\S]*practice: current\.practice\.filter/);
assert.match(context, /const removeSubject = useCallback[\s\S]*deletedEntryIds[\s\S]*practice: current\.practice\.filter/);
assert.match(notebook, /const mistakeCount = snapshot\.entries\.filter/);
assert.match(knowledge, /if \(children\.count > 0 \|\| contents\.count > 0\)/);
assert.match(capture, /mode === "mistake" \? <>[\s\S]*<span>Mistake<\/span>[\s\S]*<span>Correction<\/span>/);
console.log("Mistake Log cards: selection, Review resolution, recall and capture invariants passed.");
