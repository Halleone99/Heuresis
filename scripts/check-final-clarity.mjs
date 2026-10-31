import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync("src/App.tsx", "utf8");
const library = readFileSync("src/components/LibraryView.tsx", "utf8");
const topic = readFileSync("src/components/TopicModal.tsx", "utf8");
const pack = readFileSync("src/components/PackView.tsx", "utf8");

assert.match(app, /<button type="button" className="desktop-action desktop-search-action" onClick=\{openPalette\}/, "One global Search entry point is used in every section");
assert.doesNotMatch(app, /section === "study"\s*\? <button className="desktop-action desktop-search-action"/, "Study cannot quietly open a different search than Ctrl+K");
assert.match(app, /onSearchCards=\{\(query\)/, "Full-card search remains available through unified search");
assert.match(app, /Trash & export/, "Account actions use clear labels");
assert.match(app, /Sync now/, "Sync action uses a concise label");

assert.match(library, /className="topic-card-main" onClick=\{\(\) => onOpen\(pack\)\}/, "Entire topic card remains clickable");
assert.doesNotMatch(library, /<button onClick=\{\(\) => onOpen\(pack\)\}><ArrowRight size=\{14\} \/> Open<\/button>/, "No redundant Open button underneath a topic that already opens");
assert.match(library, /onEditPack\(pack\).*Topic settings/, "Topic settings remain reachable");
assert.match(library, /onOpenNewWords\(activeCollection\)/, "Discoveries remain available");
assert.match(library, /onOpenCaptureInbox\(activeCollection\)/, "Drafts remain available");

assert.match(topic, /pack \? "Edit topic" : "Create topic"/, "Topic dialog uses explicit headings");
assert.doesNotMatch(topic, /bounded learning space|Rename or reorganise/, "No technical or vague headings");
assert.match(pack, /Card journey/, "Card placement and review progress are labelled plainly");
assert.doesNotMatch(pack, /Card workflow · filter by stage/, "No technical stage heading");

console.log("Final UI clarity: single search, topic open, clear labels and preserved destinations passed.");
