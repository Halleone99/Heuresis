import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/workspaceSignal.ts", "utf8");
const js = ts.transpileModule(source, {compilerOptions:{
  target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS,
}}).outputText;
const mod = { exports: {} };
new Function("module","exports",js)(mod,mod.exports);
const { workspaceChangeKey, signalWorkspaceChange, subscribeWorkspaceChanges } = mod.exports;
const stored = new Map();
const listeners = new Set();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key,value) => stored.set(key,String(value)),
  removeItem: (key) => stored.delete(key),
};
globalThis.window = {
  addEventListener: (event, fn) => { if(event === "storage")listeners.add(fn); },
  removeEventListener: (event, fn) => { if(event === "storage")listeners.delete(fn); },
};
let first = 0, second = 0;
const unsubA = subscribeWorkspaceChanges("user-a", () => first++);
const unsubB = subscribeWorkspaceChanges("user-b", () => second++);
signalWorkspaceChange("user-a");
const keyA = workspaceChangeKey("user-a");
assert.equal(keyA,"heuresis.knowledge.changed.v1:user-a");
const value = stored.get(keyA);
assert.ok(value && !value.includes("note text") && !value.includes("token"));
const trigger = (key, newValue="signal", oldValue=null) =>
  [...listeners].forEach((listener) => listener({key,newValue,oldValue}));
trigger(keyA, value);
assert.deepEqual([first,second],[1,0],"Account isolation");
trigger(keyA, value, value);
assert.equal(first,1,"Ignore unchanged signals");
trigger("heuresis.knowledge.changed.v1:user-b");
assert.deepEqual([first,second],[1,1]);
unsubA(); unsubB();
trigger(keyA);
assert.deepEqual([first,second],[1,1],"Unsubscribe on unmount");

const context = readFileSync("src/components/workspace/WorkspaceContext.tsx","utf8");
assert.match(context,/const setSnapshotLocal = useCallback/);
assert.match(context,/signalWorkspaceChange\(userId\)/);
assert.match(context,/subscribeWorkspaceChanges\(userId, scheduleCrossWindowReload\)/);
assert.match(context,/setSnapshot\(result\.snapshot\)/,
  "Server reload must not rebroadcast to avoid an infinite loop");
// Local mutations go through setSnapshotLocal (which signals the other window).
// Only two server-derived updates use setSnapshot with an updater: adopting the
// first load together with captures made during it, and adopting the revision of
// an offline edit the server has just accepted.
const updaters = context.match(/setSnapshot\(\(\w+\) =>/g) ?? [];
assert.equal(updaters.length, 2, "Every local change must signal another window");
assert.match(context, /setSnapshot\(\(local\) => mergeFirstLoad\(result\.snapshot, local\)\)/);
assert.match(context, /subscribeReplayedRows\(/);
assert.match(context,/if \(loadingRef\.current\) \{ scheduleCrossWindowReload\(\); return; \}/);
assert.match(context,/window\.clearTimeout\(refreshTimer\)/);
console.log("Cross-window knowledge isolation and reload regression checks passed.");
