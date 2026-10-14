import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const notebook = readFileSync("src/components/workspace/NotebookView.tsx", "utf8");
const css = readFileSync("src/components/workspace/workspace.css", "utf8");
assert.match(notebook, /<RowMenu label=\{title\} items=\{\[/,
  "Scope action menu should contain creation rather than a duplicate tile");
assert.match(notebook, /label: topic \? "New sub-topic" : "New topic"/);
assert.doesNotMatch(notebook, /className="nb-subtopic is-add"/);
assert.match(notebook, /creatingChild && workspace\.writable/);
assert.match(notebook, /const ownTopicName = workspace\.topicById\.get\(entry\.topic_id\)/);
assert.match(notebook, /const showKind = !ownTopicName \|\| ownTopicName !== kindLabel\.toLocaleLowerCase\(\)/);
assert.match(notebook, /\{metadata \? <small>\{metadata\}<\/small> : null\}/);
assert.match(css, /@media \(min-width: 901px\) \{\s*\.nb-crumbs \.nb-back \{ display: none; \}/);
console.log("Notebook de-duplication checks passed.");
