import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const load=(p)=>{const js=ts.transpileModule(readFileSync(p,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText;
  const module={exports:{}};new Function("module","exports",js)(module,module.exports);return module.exports;};
const values=new Map();
globalThis.localStorage={
  getItem:(key)=>values.get(key)??null,
  setItem:(key,value)=>values.set(key,String(value)),
  removeItem:(key)=>values.delete(key)
};
const scroll=load("src/lib/sectionScroll.ts");
scroll.writeSectionScroll("a",{
  notebook:{page:"topic|doc",y:812.9},
  progress:{page:"",y:177},
});
assert.equal(scroll.readSectionScroll("a").notebook.y,812);
assert.equal(scroll.readSectionScroll("a").notebook.page,"topic|doc");
assert.equal(scroll.readSectionScroll("a").progress.y,177);
assert.deepEqual(scroll.readSectionScroll("b"),{}, "Account B must not see A's scroll position");
values.set("heuresis.scroll.positions.v1:a",JSON.stringify({
  notebook:{page:"x",y:-5},study:{page:"valid",y:50},
  progress:{page:"",y:Infinity},unknown:{page:"valid",y:99},
  mistakes:{page:"okay",y:501}
}));
assert.deepEqual(scroll.readSectionScroll("a"),{study:{page:"valid",y:50},mistakes:{page:"okay",y:501}});
values.set("heuresis.scroll.positions.v1:a","{broken-json");
assert.deepEqual(scroll.readSectionScroll("a"),{});

const memory=load("src/lib/workspaceMemory.ts");
assert.equal(memory.readMemory("a").progress.range,12);
const updated={...memory.readMemory("a"),progress:{range:26}};
memory.writeMemory("a",updated);
assert.equal(memory.readMemory("a").progress.range,26);
const broken={...updated,progress:{range:999}};
memory.writeMemory("a",broken);
assert.equal(memory.readMemory("a").progress.range,12);
assert.equal(memory.readMemory("b").progress.range,12);

const app=readFileSync("src/App.tsx","utf8");
const progress=readFileSync("src/components/workspace/ProgressView.tsx","utf8");
const css=readFileSync("src/components/workspace/workspace.css","utf8");
assert.match(app,/useSectionScroll\(section,[\s\S]*?session\.user\.id\)/);
assert.match(app,/readSectionScroll\(userId\)/);
assert.match(app,/writeSectionScroll\(userId, positions\.current\)/);
assert.match(app,/saved\?\.page === page \? saved\.y : 0/);
assert.match(app,/window\.addEventListener\("pagehide", persist\)/);
assert.match(progress,/const range: Range = workspace\.memory\.progress\.range/);
assert.match(progress,/progress: \{ \.\.\.current\.progress, range: next \}/);
assert.match(css,/@keyframes ws-page-enter/);
assert.match(css,/animation: ws-page-enter \.18s ease-out both/);
assert.match(css,/\.nb-doc-row, \.nb-subtopic, \.nb-link-button\):focus-visible/);
assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important/);
console.log("Account-scoped navigation, Progress range, keyboard focus and restrained motion regressions passed.");
