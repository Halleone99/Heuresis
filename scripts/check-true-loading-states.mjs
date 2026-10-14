import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shell=readFileSync("src/App.tsx","utf8");
const overview=readFileSync("src/components/workspace/OverviewView.tsx","utf8");
for(const section of ["overview","notebook","mistakes","progress"]){
  assert.match(shell,new RegExp('section === "'+section+'" && !workspace\\.loading && !workspace\\.error'),"Page should not show empty data on failed loading: "+section);
}
assert.match(shell,/workspace\.loading && !workspace\.error \? <div className="ws-loading" role="status"/);
assert.match(shell,/section === "notebook" && !workspace\.loading && !workspace\.error \? <NotebookSidebarTree \/>/,"Sidebar must not falsely appear empty on load errors");
assert.match(shell,/workspace\.error \? <div className="ws-error-panel" role="alert"/);
assert.match(shell,/onClick=\{\(\) => void workspace\.reload\(\)\}/,"Retry remains functional");
assert.match(overview,/studyHistoryState/, "Study history has an explicit state");
assert.match(overview,/setStudyHistoryState\("ready"\)/);
assert.match(overview,/setStudyHistoryState\("error"\)/);
assert.match(overview,/onClick=\{\(\) => setRetryStudyHistory\(\(count\) => count \+ 1\)\}/,"History failure is recoverable");
assert.match(overview,/studyHistoryState === "loading" \? "Loading study history…"/);
assert.match(overview,/studyHistoryState === "error" \?/, "Failure does not look like an empty session history");
console.log("Notebook loading, retry and Study-history state differentiation checks passed.");
