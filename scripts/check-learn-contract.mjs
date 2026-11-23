// Local regression tests for the production Learn scoring and readiness rules.
// Run: node scripts/check-learn-contract.mjs  (requires the project's TypeScript dependency)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function productionDeclarations(path, names) {
  const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = file.statements.filter((node) => {
    if (ts.isFunctionDeclaration(node)) return names.includes(node.name?.text);
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && names.includes(d.name.text));
    return false;
  });
  assert.equal(selected.length, names.length, "All expected production declarations must exist: " + path);
  const snippet = selected.map((node) => node.getText(file).replace(/^export\s+/, "")).join("\n");
  return ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

const scoreCode = productionDeclarations("src/lib/learnRounds.ts", [
  "ROUND_SIZE", "POINTS_PER_EXERCISE", "ROUND_MAX", "READY_SCORE", "pointsFor", "roundResult",
]);
const score = vm.runInNewContext(scoreCode + "\n({pointsFor,roundResult,READY_SCORE})");
const right = Array.from({ length: 5 }, (_, i) => ({ position: i + 1, correct: true, assisted: false }));
assert.equal(score.READY_SCORE, 100);
assert.equal(score.roundResult(right, 0).score, 50);
assert.equal(score.roundResult(right, 0).ready, false, "First 50-point round must remain in Learn");
assert.equal(score.roundResult(right, 40).score, 90);
assert.equal(score.roundResult(right, 40).ready, false);
assert.equal(score.roundResult(right, 50).ready, true, "Only 100 points makes Review available");
assert.equal(score.roundResult(right.map((a) => ({ ...a, correct: false })), 50).ready, false);

const statusCode = productionDeclarations("src/lib/learnSession.ts", ["learnStatus"]);
const context = {
  readAcquisition: () => ({ cycle: 1 }),
  stateForCycle: (state) => state,
  legacyReady: () => false,
  READY_SCORE: score.READY_SCORE,
};
vm.createContext(context);
const status = vm.runInContext(statusCode + "\nlearnStatus", context);
const card = { data: {} };
assert.equal(status(card, { last: { ready: true, score: 50 }, active: null }), "retry", "Ignore legacy ready flag");
assert.equal(status(card, { last: { ready: false, score: 100 }, active: null }), "ready", "Calculate readiness from actual mastery");
assert.equal(status(card, { last: { ready: false, score: 90 }, active: null }), "retry");
assert.equal(status(card, { last: null, active: { score: 90 } }), "started");

console.log("Learn scoring and readiness regression tests passed.");
