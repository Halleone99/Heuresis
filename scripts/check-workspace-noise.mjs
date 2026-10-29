import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx","utf8");
const overview = readFileSync("src/components/workspace/OverviewView.tsx","utf8");
const notebook = readFileSync("src/components/workspace/NotebookView.tsx","utf8");

assert.equal(app.includes('className="hw-capture-hint"'), false);
assert.ok(app.includes('className="desktop-action hw-sync-indicator"'));
assert.ok(app.includes('setSyncOpen(true)'));
assert.ok(app.includes('<SyncStatusDialog state={syncState}'));
// Header is for universal tools; Study creation belongs on the relevant page.
assert.doesNotMatch(app, /desktop-topic-action|desktop-action desktop-primary/, "No global topic/card creation buttons");
assert.match(app, /className="hw-sidebar-capture"[\s\S]*?aria-label="Open Quick Capture"/, "The sidebar feather is labelled for accessibility");
assert.match(app, /<Feather size=\{27\}/, "Quick Capture uses the feather symbol");
assert.doesNotMatch(app, /desktop-action hw-capture-button/, "No duplicate top-right Capture button");
assert.match(app, /onNewTopic=\{openNewTopic\}/, "Study passes the topic creator to its collection view");
const library = readFileSync("src/components/LibraryView.tsx", "utf8");
assert.match(library, /className="collection-new-topic" onClick=\{\(\) => onNewTopic\(activeCollection.id\)\}/, "Collection creation is contextual");
assert.equal(overview.includes('Recent lessons'), false);
assert.equal(overview.includes('Questions to clarify'), false);
assert.equal(overview.includes('className="ov-empty-line"'), false);
assert.ok(overview.includes('Last 26 weeks'), "Overview should show the Study-only calendar");
assert.ok(overview.includes('Choose a Study topic'), "Overview should offer one selectable topic at a time");
assert.ok(!overview.includes('Notes to revisit') && !overview.includes('Browse subjects'));
assert.ok(notebook.includes('<div className="ws-segmented" role="tablist"'));
assert.equal(notebook.includes('<span>{counts.all - counts.lessons}'), false);
console.log("Workspace duplication checks passed.");
