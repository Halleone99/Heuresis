import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shell=readFileSync("src/App.tsx","utf8");
const overview=readFileSync("src/components/workspace/OverviewView.tsx","utf8");
for(const section of ["notebook","mistakes"]){
  assert.match(shell,new RegExp('section === "'+section+'" && !workspace\\.loading && !workspace\\.error'),"Page should not show empty data on failed loading: "+section);
}
assert.match(shell,/workspace\.loading && !workspace\.error \? <div className="ws-loading" role="status"/);
assert.match(shell,/section === "notebook" && !workspace\.loading && !workspace\.error \? <NotebookSidebarTree \/>/,"Sidebar must not falsely appear empty on load errors");
assert.match(shell,/workspace\.error \? <div className="ws-error-panel" role="alert"/);
assert.match(shell,/onClick=\{\(\) => void workspace\.reload\(\)\}/,"Retry remains functional");
assert.match(shell,/section === "overview" \? <OverviewView/, "Study Overview is independent of Notebook loading");
assert.match(overview,/Review history unavailable/,"Overview distinguishes loading failures from zero reviews");
assert.match(overview,/activityLoading \|\| activityError \|\| !activity/,"Overview only shows reviewed-card counts after history loads");
console.log("Notebook loading, retry and Study-history state differentiation checks passed.");
