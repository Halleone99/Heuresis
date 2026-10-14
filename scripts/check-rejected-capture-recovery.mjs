import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ctx=readFileSync("src/components/workspace/WorkspaceContext.tsx","utf8");
const capture=readFileSync("src/components/workspace/QuickCapture.tsx","utf8");
const memory=readFileSync("src/lib/workspaceMemory.ts","utf8");
assert.match(ctx,/type CaptureDraftSurface/);
assert.match(ctx,/submitCapture: \(input: EntryInput, label: string, surface\?: CaptureDraftSurface\)/);
assert.match(ctx,/surface: CaptureDraftSurface = "inline"/);
assert.match(ctx,/!readCaptureDraft\(userId, surface\)\) writeCaptureDraft\(userId, \{/);
assert.match(ctx,/updatedAt: new Date\(\)\.toISOString\(\),\s*\}, surface\);/);
assert.match(ctx,/Your draft remains in the original Capture window/);
assert.doesNotMatch(ctx,/!readCaptureDraft\(userId\)\)/);
assert.match(capture,/submitCapture\(input, label, draftSurface\)/);
assert.match(capture,/lessonId \}, label, draftSurface\)/);
assert.match(memory,/captureDraftKey\(userId, surface\)/);
// A rejected native capture must not touch the old inline draft key.
const invalidCalls=[...ctx.matchAll(/readCaptureDraft\(userId(?:, ([\w]+))?\)/g)];
assert.ok(invalidCalls.every((match)=>match[1]==="surface"));
console.log("Rejected floating capture restores only the originating draft slot.");
