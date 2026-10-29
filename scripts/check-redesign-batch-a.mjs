import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const notebook = read("src/components/workspace/NotebookView.tsx");
const document = read("src/components/workspace/DocumentPage.tsx");
const mistakes = read("src/components/workspace/MistakeLog.tsx");
const capture = read("src/components/workspace/QuickCapture.tsx");
const overview = read("src/components/workspace/OverviewView.tsx");
const css = read("src/components/workspace/workspace.css");

assert.match(notebook, /const goBack = useCallback\(/, "Preserve notebook navigation history");
assert.match(notebook, /event\.altKey && event\.key === "ArrowLeft"/, "Keep Alt+Left notebook navigation");
assert.doesNotMatch(notebook, /<button type="button" className="nb-back"/, "No duplicate arrow in Notebook breadcrumbs");
assert.doesNotMatch(document, /<button type="button" className="nb-back"/, "No duplicate arrow in note breadcrumbs");
assert.match(document, /onClose\(\)/, "Note close still returns to its topic");

assert.match(capture, /<span className="qc-label">Save in<\/span>/, "Capture has one destination label");
assert.doesNotMatch(capture, /mode === "lesson" \? "In" : "To"/, "No inconsistent destination label");
assert.match(capture, /You can save straight away in Unsorted/, "Quick capture works without forced categorisation");
assert.match(mistakes, /<h1>\{title\}<\/h1>/, "Mistake Log heading reflects the selected subject or topic");
assert.match(mistakes, /aria-label="Mistake Log location"/, "Breadcrumbs retain a clear home location");
assert.doesNotMatch(mistakes, /Mistake → Correction → Practice → Progress/, "No developer-style headings");
assert.doesNotMatch(overview, /Objectives from Personal OS appear here/, "No technical objective empty-state copy");
assert.match(overview, /onClick=\{onOpenStudy\}/, "Overview retains a direct Study link");
assert.doesNotMatch(overview, /<button[^>]*>Open lesson <ArrowRight/, "No duplicate primary action in active lesson");
assert.doesNotMatch(notebook, /action=\{workspace\.writable && fallbackTopic \? <div className="ws-empty-actions"/, "Notebook empty state relies on header action");

assert.match(css, /\.ws-button\.is-primary \{ background: var\(--ws-accent-strong\)/, "Primary action uses the theme accent");
assert.match(css, /\.ws-button\.is-primary:disabled \{ background: var\(--ws-sunken\)/, "Disabled primaries are visibly disabled");
assert.match(css, /\.nb-welcome p[^\n]+var\(--ws-sans\)/, "Explanatory prose uses UI sans");
assert.match(css, /\.nb-prose :is\(\[lang="zh"\]/, "Target-language spans retain reading serif");
assert.match(css, /\.qc-field textarea \{ font:[^\n]+var\(--ws-sans\)/, "Capture form UI uses sans");

assert.match(document, /const previousTopicId = liveEntry\.topic_id;/, "Move stores the original topic");
assert.match(document, /void applyTopic\(previousTopicId\)/, "Move Undo persists the old topic");
assert.match(document, /savedRef\.current = \{ \.\.\.savedRef\.current, topicId: destination \}/, "Undo restores the document draft location");
assert.match(mistakes, /await confirm\(\{/, "Deleting a correction requires confirmation");
assert.match(mistakes, /await workspace\.removeEntry\(entry\.id\)/, "Correction deletion uses the reversible workspace action");
assert.match(mistakes, /await workspace\.patchEntry\(entry\.id, \{[\s\S]*attempt:/, "Editing a correction preserves its other metadata");

console.log("Batch A: navigation, language labels, interface hierarchy, typography and reversible actions passed.");
