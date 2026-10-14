import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("src/lib/progressLanguage.ts", "utf8");
const js = ts.transpileModule(source, {compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText;
const mod={exports:{}};
new Function("module","exports",js)(mod,mod.exports);
const {languageStack}=mod.exports;
const start=(year,month,day)=>new Date(year,month-1,day);
const weeks=[5,12,19].map((day)=>({start:start(2026,10,day),key:start(2026,10,day).toISOString(),value:0}));
const subjects=[{id:"de",name:"German"},{id:"ru",name:"Russian"},{id:"zh",name:"Chinese"}];
const events=[
  {at:"2026-10-05",subjectId:"de"},
  {at:"2026-10-06T12:00:00",subjectId:"de"},
  {at:"2026-10-13",subjectId:"zh"},
  {at:"2026-10-14T15:25:00",subjectId:"ru"},
  {at:"2026-10-15",subjectId:"missing"},
  {at:"2026-10-22",subjectId:"de"},
  {at:"2026-09-30",subjectId:"zh"},
  {at:"not-a-date",subjectId:"de"},
];
const result=languageStack(weeks,events,subjects);
assert.deepEqual(result.series.map((item)=>item.name),["Chinese","German","Russian","Unassigned"]);
assert.deepEqual(result.weeks.map((week)=>week.value),[2,3,1]);
assert.equal(result.weeks[0].segments.de,2);
assert.equal(result.weeks[1].segments.zh,1);
assert.equal(result.weeks[1].segments.ru,1);
assert.equal(result.weeks[1].segments.__unassigned__,1);
assert.equal(result.weeks[2].segments.de,1);
assert.equal(result.weeks.reduce((sum,week)=>sum+week.value,0),6);
for(const week of result.weeks) assert.equal(week.value,
  Object.values(week.segments).reduce((sum,value)=>sum+value,0));
assert.deepEqual(languageStack(weeks,[],subjects).series,[]);
assert.deepEqual(languageStack([],events,subjects).weeks,[]);

const progress=readFileSync("src/components/workspace/ProgressView.tsx","utf8");
const css=readFileSync("src/components/workspace/workspace.css","utf8");
assert.match(progress,/languageStack\(weeks,/);
assert.match(progress,/series=\{lessonStack\.series\}/);
assert.match(progress,/series=\{recallStack\.series\}/);
assert.match(progress,/series=\{noteStack\.series\}/);
assert.match(progress,/className="pg-stack-segment"/);
assert.match(progress,/className="pg-language-legend"/);
assert.match(progress,/className="pg-tip-languages"/);
assert.match(progress,/series\.map\(\(item\) => <td key=\{item\.id\}>/);
assert.match(css,/--ws-chart-series-1: var\(--ws-bar\)/);
assert.match(css,/\.pg-bar \.pg-stack-segment/);
console.log("Progress per-language stacked chart math, orphan totals and accessible displays passed.");
