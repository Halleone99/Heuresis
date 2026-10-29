import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sidebar=readFileSync("src/components/workspace/NotebookSidebarTree.tsx","utf8");
const app=readFileSync("src/App.tsx","utf8");
const css=readFileSync("src/components/workspace/workspace.css","utf8");
const notebook=readFileSync("src/components/workspace/NotebookView.tsx","utf8");
assert.match(app, /section === "notebook" && !workspace\.loading && !workspace\.error \? <NotebookSidebarTree \/>/,
  "Global sidebar should show language/topic navigation only in Notebook");
assert.match(app, /SECTIONS\.map/,
  "Existing five-section navigation stays intact");
assert.match(sidebar, /snapshot\.subjects/);
assert.match(sidebar, /workspace\.childrenOf\(parentId, subjectId\)/);
assert.match(sidebar, /workspace\.openTopic\(topicId\)/);
assert.match(sidebar, /aria-label="Notebook navigation"/);
assert.match(sidebar, /aria-label="Subjects"/);
assert.match(sidebar, /notebook: \{\s*\.\.\.current\.notebook, subjectId, topicId: null, docId: null/,
  "Selecting a language must clear a stale document");
assert.match(sidebar, /workspace\.addSubject\(clean\)/);
assert.match(sidebar, /workspace\.ensureInbox\(subject\.id\)/);
assert.match(sidebar, /workspace\.addTopic\(creating\.subjectId, clean, creating\.parentId\)/);
assert.match(sidebar, /workspace\.renameSubjectById/);
assert.match(sidebar, /workspace\.changeTopic/);
const removal=readFileSync("src/components/workspace/KnowledgeRemovalDialog.tsx","utf8");
const workspace=readFileSync("src/components/workspace/WorkspaceContext.tsx","utf8");
assert.match(sidebar, /KnowledgeRemovalDialog/, "Sidebar uses shared confirmation and move-first dialog");
assert.match(notebook, /KnowledgeRemovalDialog/, "Notebook drawer uses the same safe removal flow");
assert.match(removal, /Move contents first/, "Offer relocation before permanent deletion");
assert.match(removal, /Delete everything/, "Destructive removal remains an explicit choice");
assert.match(removal, /verification !== target\.name/, "Require exact-name confirmation for non-empty trees");
assert.match(removal, /workspace\.manageSubjectTree/, "Deletion executes an owner-scoped transaction");
assert.match(removal, /workspace\.manageTopicTree/, "Topic removal can preserve subtopic trees");
assert.match(workspace, /manageSubjectTree/, "Workspace synchronises moved subjects");
assert.match(workspace, /manageTopicTree/, "Workspace synchronises moved topics");
assert.match(notebook, /<NotebookRail location=\{location\}/,
  "Legacy narrow-window Notebook drawer must remain");
assert.match(css, /@media \(min-width: 901px\) \{[\s\S]*?\.heuresis-desktop\[data-section="notebook"\] \.nb-rail,[\s\S]*?display: none !important;/);
assert.match(css, /@media \(max-width: 900px\) \{\s*\.hw-notebook-tree \{ display: none !important; \}/);
assert.match(css, /\.heuresis-desktop\[data-sidebar="rail"\] \.hw-notebook-tree \{ display: none; \}/);
// On desktop, hover reveals both navigation labels and the Notebook topic tree;
// keyboard-visible focus must provide the same access without a mouse.
assert.ok(css.includes(".heuresis-section-sidebar:is(:hover, :has(:focus-visible))"),
  "Hover or keyboard focus opens the compact navigation rail");
assert.ok(css.includes(".heuresis-section-sidebar:is(:hover, :has(:focus-visible)) .hw-notebook-tree"),
  "Hover or keyboard focus reveals the Notebook topic tree");
assert.ok(notebook.includes("lastRevealedTopicId.current === visibleTopicId"),
  "Only a changed navigation destination reveals the selected topic");
assert.ok(notebook.includes("if (!missing.length) return current;"),
  "Refreshes cannot rebuild the expanded folder list");
console.log("Notebook main sidebar and move-first tree removal contracts passed.");
