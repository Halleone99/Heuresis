import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar=readFileSync("src/components/workspace/NotebookSidebarTree.tsx","utf8");
const app=readFileSync("src/App.tsx","utf8");
const css=readFileSync("src/components/workspace/workspace.css","utf8");
const notebook=readFileSync("src/components/workspace/NotebookView.tsx","utf8");
assert.match(app, /section === "notebook" \? <NotebookSidebarTree \/>/,
  "Global sidebar should show language/topic navigation only in Notebook");
assert.match(app, /SECTIONS\.map/,
  "Existing five-section navigation stays intact");
assert.match(sidebar, /snapshot\.subjects/);
assert.match(sidebar, /workspace\.childrenOf\(parentId, subjectId\)/);
assert.match(sidebar, /workspace\.openTopic\(topicId\)/);
assert.match(sidebar, /aria-label="Notebook navigation"/);
assert.match(sidebar, /aria-label="Languages"/);
assert.match(sidebar, /notebook: \{\s*\.\.\.current\.notebook, subjectId, topicId: null, docId: null/,
  "Selecting a language must clear a stale document");
assert.match(sidebar, /workspace\.addSubject\(clean\)/);
assert.match(sidebar, /workspace\.ensureInbox\(subject\.id\)/);
assert.match(sidebar, /workspace\.addTopic\(creating\.subjectId, clean, creating\.parentId\)/);
assert.match(sidebar, /workspace\.renameSubjectById/);
assert.match(sidebar, /workspace\.changeTopic/);
assert.match(sidebar, /workspace\.subtreeIds\(topic\.id\)/);
assert.match(sidebar, /if \(entries \|\| workspace\.childrenOf\(topic\.id, topic\.subject_id\)\.length\)/,
  "Prevent deletion of non-empty topic");
assert.match(sidebar, /if \(snapshot\.entries\.some\(\(entry\) => ids\.has\(entry\.topic_id\)\)\)/,
  "Prevent deleting a language with notes");
assert.match(notebook, /<NotebookRail location=\{location\}/,
  "Legacy narrow-window Notebook drawer must remain");
assert.match(css, /@media \(min-width: 901px\) \{[\s\S]*?\.heuresis-desktop\[data-section="notebook"\] \.nb-rail,[\s\S]*?display: none !important;/);
assert.match(css, /@media \(max-width: 900px\) \{\s*\.hw-notebook-tree \{ display: none !important; \}/);
assert.match(css, /\.heuresis-desktop\[data-sidebar="rail"\] \.hw-notebook-tree \{ display: none; \}/);
assert.match(css, /\.heuresis-desktop\[data-sidebar="rail"\] \.heuresis-section-sidebar:is\(:hover,:focus-within\) \.hw-notebook-tree \{ display: flex; \}/);
console.log("Notebook main sidebar integration and single-tree guards passed.");
