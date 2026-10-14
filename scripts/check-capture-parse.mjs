import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile the real production parser, not a duplicate of its implementation.
const source = readFileSync("src/lib/captureParse.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const result = { exports: {} };
new Function("module", "exports", compiled)(result, result.exports);
const { parseCaptureLine } = result.exports;

const cases = [
  ["Ich verstehe die Regel", { kind: "note", category: "note", body: "Ich verstehe die Regel" }],
  ["Warum ist das so?", { kind: "note", category: "question", body: "Warum ist das so?" }],
  ["为什么？", { kind: "note", category: "question", body: "为什么？" }],
  ["#g der Mann", { kind: "note", category: "grammar", body: "der Mann" }],
  ["das Wort #v", { kind: "note", category: "vocabulary", body: "das Wort" }],
  ["#e sich freuen", { kind: "note", category: "phrase", body: "sich freuen" }],
  ["der Mann -> den Mann", { kind: "mistake", category: "note", attempt: "der Mann", correction: "den Mann", explanation: "" }],
  ["#g der Mann -> den Mann // Accusative masculine", { kind: "mistake", category: "grammar", attempt: "der Mann", correction: "den Mann", explanation: "Accusative masculine" }],
  ["我吃饭了的时候 → 我吃饭的时候", { kind: "mistake", category: "note", attempt: "我吃饭了的时候", correction: "我吃饭的时候", explanation: "" }],
  ["ich weiß ->", { kind: "mistake", attempt: "ich weiß", correction: "" }],
  ["https://example.com/study", { kind: "note", body: "https://example.com/study" }],
];
for (const [input, expected] of cases) {
  const actual = parseCaptureLine(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `capture shorthand ${JSON.stringify(input)}: ${key}`);
  }
}
console.log(`Capture shorthand: ${cases.length} cases passed.`);
