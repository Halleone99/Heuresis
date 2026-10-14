import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx","utf8");
const overview = readFileSync("src/components/workspace/OverviewView.tsx","utf8");
const notebook = readFileSync("src/components/workspace/NotebookView.tsx","utf8");

assert.equal(app.includes('className="hw-capture-hint"'), false);
assert.ok(app.includes('className="desktop-action hw-sync-indicator"'));
assert.ok(app.includes('setSyncOpen(true)'));
assert.ok(app.includes('<SyncStatusDialog state={syncState}'));
assert.ok(overview.includes('{lessons.length ? <section className="ws-panel">'));
assert.ok(overview.includes('{questions.length ? <section className="ws-panel">'));
assert.ok(overview.includes('className="ov-empty-line"'));
assert.ok(notebook.includes('<div className="ws-segmented" role="tablist"'));
assert.equal(notebook.includes('<span>{counts.all - counts.lessons}'), false);
console.log("Workspace duplication checks passed.");
