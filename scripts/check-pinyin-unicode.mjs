import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/lib/pinyinUnicode.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { repairPinyinToneMarks: repair } = module.exports;

const examples = [
  ["Haˇo", "Hǎo"],
  ["Niˇ haˇo!", "Nǐ hǎo!"],
  ["niˇ haˇo", "nǐ hǎo"],
  ["maˉ maˊ maˇ maˋ", "mā má mǎ mà"],
  ["lüˋ", "lǜ"],
  ["lüˇ", "lǚ"],
  ["LÜˋ", "LǛ"],
  ["u\u0308\u030c", "ǚ"],
  ["a\u030C", "ǎ"],
  ["e\u0301", "é"],
  ["chī 饭", "chī 饭"],
  ["B1 German, Lektion 7", "B1 German, Lektion 7"],
  ["für Mädchen: über", "für Mädchen: über"],
  ["Здравствуй, мир!", "Здравствуй, мир!"],
  ["ni3 hao3", "ni3 hao3"],
  ["→ // #g (?)", "→ // #g (?)"],
];
for (const [before, expected] of examples) {
  assert.equal(repair(before), expected, `Unicode tone repair on ${JSON.stringify(before)}`);
  assert.equal(repair(repair(before)), expected, `Idempotent tone repair on ${JSON.stringify(before)}`);
}
const workspace = readFileSync("src/lib/knowledgeWorkspace.ts", "utf8");
assert.ok(workspace.includes("import { repairPinyinToneMarks }"));
assert.ok(workspace.includes("title: contentStr(row.title), body: contentStr(row.body)"));
assert.ok(workspace.includes("repairPinyinToneMarks(input.body ?? \"\""));
assert.ok(workspace.includes("repairPinyinToneMarks(value)"));
const css = readFileSync("src/components/workspace/workspace.css", "utf8");
assert.ok(css.includes('--ws-serif: "Noto Serif"'));
const main = readFileSync("src/main.tsx", "utf8");
assert.ok(main.includes('@fontsource/noto-serif/400.css'));
console.log(`Pinyin Unicode: ${examples.length} cases and load/save/font guards passed.`);
