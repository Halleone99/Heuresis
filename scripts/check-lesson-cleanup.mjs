import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync("src/lib/lessonCleanup.ts", "utf8");
const code = ts.transpileModule(src, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText;
const module = { exports: {} };
new Function("module", "exports", code)(module, module.exports);
const { cleanupCandidates, mergedCaptureText, isInboxTopic } = module.exports;

const topics = [
  { id:"de-inbox", subject_id:"de", name:"Inbox", parent_id:null },
  { id:"de-grammar", subject_id:"de", name:"Grammar", parent_id:null },
  { id:"ru-inbox", subject_id:"ru", name:"Inbox", parent_id:null },
  { id:"de-child-inbox", subject_id:"de", name:"Inbox", parent_id:"de-grammar" },
];
const entry = (id, kind, topic_id, lesson_id, body="", attempt="", correction="") => ({
  id, kind, topic_id, lesson_id, body, title:"", category:"note",
  attempt, correction, created_at:`2026-10-14T12:00:0${id.length%10}Z`,
});
const entries = [
  entry("lesson-de","lesson","de-grammar",null),
  entry("a","note","de-grammar","lesson-de","Ich habe der"),
  entry("b","mistake","de-grammar","lesson-de","","der Mann","den Mann"),
  entry("c","note","de-inbox",null,"Ein Kaffee"),
  entry("d","note","de-grammar",null,"Already organised"),
  entry("e","note","de-inbox","lesson-de","Needs Inbox work"),
  entry("f","note","ru-inbox",null,"Russian"),
  entry("g","note","de-child-inbox",null,"Nested Inbox is not a language Inbox"),
  entry("h","note","de-inbox",null,"After moving"),
];
assert.deepEqual(cleanupCandidates({kind:"lesson",id:"lesson-de"},entries,topics).map(e=>e.id),["a","b"]);
assert.deepEqual(cleanupCandidates({kind:"inbox",id:"de-inbox"},entries,topics).map(e=>e.id),["c","e","h"]);
assert.deepEqual(cleanupCandidates({kind:"inbox",id:"de-child-inbox"},entries,topics),[]);
assert.deepEqual(cleanupCandidates({kind:"lesson",id:"missing"},entries,topics),[]);
assert.equal(isInboxTopic(topics[0]),true);
assert.equal(isInboxTopic(topics[3]),false);
assert.equal(mergedCaptureText([entries[1],entries[2]]),"Ich habe der\n\nder Mann → den Mann");
assert.equal(mergedCaptureText([entry("x","note","de-inbox",null,"Test")]),"Test");

const dialog = readFileSync("src/components/workspace/LessonCleanupDialog.tsx","utf8");
const context = readFileSync("src/components/workspace/WorkspaceContext.tsx","utf8");
const app = readFileSync("src/App.tsx","utf8");
const notebook = readFileSync("src/components/workspace/NotebookView.tsx","utf8");
assert.ok(dialog.includes("useConfirm()") && dialog.includes("FlashcardDialog"));
assert.ok(dialog.includes("workspace.patchEntry(row.id, { topic_id: destination })"));
assert.ok(dialog.includes("workspace.patchEntry(row.id, { category: value })"));
assert.ok(dialog.includes("workspace.addEntry({"));
assert.ok(dialog.includes("Original lines stay intact"));
assert.ok(dialog.includes("event.key === \"ArrowDown\""));
assert.ok(context.includes('setCleanupTarget({ kind: "lesson", id: lessonId })'));
assert.ok(app.includes("<LessonCleanupDialog target={workspace.cleanupTarget}"));
assert.ok(notebook.includes('workspace.openCleanup({ kind: "inbox", id: topic.id })'));
console.log("Lesson and Inbox cleanup: 8 logic and integration checks passed.");
