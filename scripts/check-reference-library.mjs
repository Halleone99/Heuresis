import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const read = (path) => readFileSync(path, "utf8");
const view = read("src/components/workspace/ReferenceLibrary.tsx");
const shell = read("src/App.tsx");
const notebook = read("src/components/workspace/NotebookView.tsx");
const chapters = read("src/lib/referenceChapters.ts");
const css = read("src/components/workspace/knowledge-catalogue.css");
const model = read("src/lib/knowledgeWorkspace.ts");

// The catalogue must be one continuous editorial browser, not Works vs Topics.
assert.match(shell, /label: "Catalogue"/);
assert.doesNotMatch(shell, /referenceMode|<ReferenceView/);
assert.match(view, /Knowledge Catalogue/);
assert.match(view, /Explore by subject/);
assert.match(view, /Recently added & revised/);
assert.match(view, /kc-reading-article/);
assert.match(css, /@media\(max-width:680px\)/);

// Notebook is the only knowledge store; all notes can be catalogue articles.
// We must not require the artificial reference category or numbered chapters.
assert.match(view, /entry\.kind === "note"/);
assert.doesNotMatch(view, /entry\.category === "reference"/);
assert.match(view, /workspace\.topicById/);
assert.match(view, /workspace\.addSubject/);
assert.match(view, /workspace\.addTopic/);
assert.match(view, /onCreate\(chosenTopic\.id\)/);
assert.match(view, /onEdit\(work\)/);
assert.match(view, /<RichText/);
assert.match(view, /Search knowledge catalogue/);
assert.match(chapters, /parseReferenceChapters/);
assert.match(notebook, /ReferenceLibrary/);
assert.match(model, /reference: "Reference"/);
console.log("Knowledge Catalogue integration checks: OK");
