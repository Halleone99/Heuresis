import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(path) {
  const source = readFileSync(path, "utf8");
  const js = ts.transpileModule(source, {compilerOptions:{
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText;
  const module = { exports: {} };
  new Function("module", "exports", js)(module, module.exports);
  return module.exports;
}
const { resolveCaptureContext } = load("src/lib/captureContext.ts");
const subject = (id) => ({ id, name: id, created_at: "", updated_at: "", user_id: "user" });
const topic = (id, subject_id, name, parent_id=null) => ({ id, subject_id, name, parent_id, user_id: "user" });
const subjects = ["de","ru","zh"].map(subject);
const topics = [
  topic("de-inbox","de","Inbox"), topic("de-grammar","de","Grammar"),
  topic("ru-inbox","ru","Inbox"), topic("zh-lesson","zh","HSK2"),
  topic("nested","de","Inbox","de-grammar"),
];
const resolve = (input={}) => resolveCaptureContext({subjects,topics,...input});
assert.deepEqual(resolve(), {subjectId:null,topicId:null}, "No arbitrary first-language fallback");
assert.deepEqual(resolve({savedSubjectId:"ru",savedTopicId:"de-grammar"}),
  {subjectId:"ru",topicId:"ru-inbox"}, "Persisted language defeats a stale topic from another language");
assert.deepEqual(resolve({savedSubjectId:"de", savedTopicId:"de-grammar"}),
  {subjectId:"de",topicId:"de-grammar"}, "Matching topic remains selected");
assert.deepEqual(resolve({savedSubjectId:"ru", lessonTopicId:"zh-lesson"}),
  {subjectId:"zh",topicId:"zh-lesson"}, "Active lesson takes precedence over previous language");
assert.deepEqual(resolve({savedSubjectId:"ru", requestedTopicId:"de-grammar"}),
  {subjectId:"de",topicId:"de-grammar"}, "Explicit opening request overrides sticky language");
assert.deepEqual(resolve({notebookSubjectId:"de"}), {subjectId:"de",topicId:"de-inbox"});
assert.deepEqual(resolve({notebookTopicId:"de-grammar"}), {subjectId:"de",topicId:"de-grammar"});
assert.deepEqual(resolve({savedSubjectId:"zh"}), {subjectId:"zh",topicId:null},
  "Language without an Inbox must be retained until Inbox creation");
assert.deepEqual(resolve({savedSubjectId:"no-such-language"}), {subjectId:null,topicId:null});
assert.deepEqual(resolveCaptureContext({subjects:[subject("de")], topics}),{subjectId:"de",topicId:"de-inbox"});
assert.equal(resolveCaptureContext({subjects:[subject("de")],topics:[]}).subjectId,"de");

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key,String(value)),
  removeItem: (key) => storage.delete(key),
};
const mem = load("src/lib/workspaceMemory.ts");
const makeDraft = (text) => ({
  mode:"note", text, category:"note",categoryTouched:false, attempt:"",
  correction:"",explanation:"",lessonTitle:"", updatedAt:"2026-10-14T15:30:00Z",
});
mem.writeCaptureDraft("user",makeDraft("German inline"));
mem.writeCaptureDraft("user",makeDraft("Chinese floating"),"floating");
assert.equal(mem.readCaptureDraft("user").text,"German inline");
assert.equal(mem.readCaptureDraft("user","floating").text,"Chinese floating");
mem.writeCaptureDraft("user",null,"floating");
assert.equal(mem.readCaptureDraft("user","floating"),null);
assert.equal(mem.readCaptureDraft("user").text,"German inline", "Closing floating cannot discard inline draft");
assert.equal(mem.readMemory("user").capture.subjectId,null);
mem.writeMemory("user", { ...mem.readMemory("user"), capture: { ...mem.readMemory("user").capture, subjectId:"de", topicId:"de-inbox" }});
assert.equal(mem.readMemory("user").capture.subjectId,"de");

const quick = readFileSync("src/components/workspace/QuickCapture.tsx","utf8");
const floating = readFileSync("src/components/workspace/FloatingQuickCapture.tsx","utf8");
assert.match(quick, /resolveCaptureContext\(/);
assert.match(quick, /draftSurface = floating \? "floating" : "inline"/);
assert.match(quick, /Choose a language before saving/);
assert.match(quick, /role="group" aria-label="Capture language"/);
assert.match(quick, /capture: \{ \.\.\.current\.capture, subjectId, topicId: nextTopic \}/);
assert.doesNotMatch(quick, /snapshot\.subjects\[0\]/, "Never arbitrarily default to first subject");
assert.doesNotMatch(floating, /keepOpen: true, stream: true/, "Native stream should not force inline settings");
console.log("Language context, draft isolation and native stream: 15+ checks passed.");
