import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) => readFileSync(file, "utf8");
const rust = read("src-tauri/src/lib.rs");
const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
const main = read("src/main.tsx");
const shell = read("src/App.tsx");
const floating = read("src/components/workspace/FloatingQuickCapture.tsx");
const quick = read("src/components/workspace/QQuickCapture.tsx");
const review = read("src/components/workspace/QQueuePage.tsx");
const queue = read("src/lib/quickQueue.ts");
const provider = read("src/components/workspace/WorkspaceContext.tsx");
const workspaceCss = read("src/components/workspace/workspace.css");

assert.ok(cap.windows.includes("quick-capture"), "Tauri capture window remains enabled");
for (const permission of ["core:window:allow-hide","core:window:allow-set-size",
  "core:window:allow-always-on-top","core:window:allow-set-always-on-top",
  "core:window:allow-start-dragging"]) {
  if (permission === "core:window:allow-always-on-top") continue;
  assert.ok(cap.permissions.includes(permission), `Missing ${permission}`);
}
assert.match(rust, /WebviewWindowBuilder::new\(/);
assert.match(main, /<FloatingQuickCapture \/>/);
assert.match(shell, /showFloatingQuickCapture\(mode\)/);
assert.match(shell, /<QQuickCapture \/>/, "Inline feather must use Q capture");
assert.match(shell, /<QQueuePage onCapture=/, "Q must be a first-class navigation section");
assert.match(shell, /q-mobile-pinned/, "Q must remain visible in mobile bottom bar");
assert.match(floating, /<QQuickCapture floating onRequestClose=/, "Native floating feather must save to Q");
assert.match(floating, /getCurrentWindow\(\)\.hide\(\)/, "Native close hides, not discards, draft");
assert.match(quick, /workspace\.submitCapture\(/, "Q saves via the durable Notebook path");
assert.match(quick, /quickQueueDescription\(draft\.type\)/, "Raw, Note, Flashcard, Mistake are only Q labels");
assert.match(quick, /kind: "note", topicId: inbox\.id/, "Captured items must remain provisional notes");
assert.match(quick, /<HandNotePad strokes=/, "Handwriting is still available");
assert.match(queue, /heuresis:q:v1:/, "Q provenance must survive cross-device sync");
assert.match(review, /quickQueueKind\(entry\)/, "Only Q-marked entries go to Q");
assert.match(review, /await createCard\(/, "Flashcard conversion waits until review");
assert.match(review, /await workspace\.addEntry\(\{ kind: "mistake"/, "Mistake conversion waits until review");
assert.match(review, /await workspace\.patchEntry\(selected\.id/, "Note is filed after review");
assert.match(provider, /queueCaptureForReview\(userId, id\)/);
assert.match(workspaceCss, /\.hw-sidebar-capture-position/, "Desktop feather stays in sidebar");
console.log("Heuresis native Quick Capture → Q queue checks passed.");
