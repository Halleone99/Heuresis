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
assert.match(overview,/const \[activityLoading, setActivityLoading\]/,"Study activity has a loading state");
assert.match(overview,/setActivityLoading\(false\)/);
assert.match(overview,/const \[activityError, setActivityError\]/,"Study activity has an error state");
assert.match(overview,/setActivityError\("unavailable"\)/);
assert.match(overview,/onRetry=\{\(\) => setRetry\(\(value\) => value \+ 1\)\}/,"Study retry remains functional");
assert.match(overview,/Study activity unavailable; only Notebook activity is shown\./,"Failure must not look like zero activity");
console.log("Notebook loading, retry and Study-history state differentiation checks passed.");
