import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTs } from "./lib/load-ts.mjs";

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

const { learningBuildTileReadings } = loadTs("src/lib/learningPinyin.ts");
const card = (form, reading, examples = []) => ({ form, reading, examples, han: true, language: "zh" });
const build = (text, distractors = []) => {
  const answer = Array.from(text);
  return { kind: "build-term", format: "build", answer, joiner: "",
    tiles: [...answer, ...distractors].map((part, index) => ({ id: `t${index}`, text: part })) };
};
const sentence = learningBuildTileReadings(build("这个太难了", ["要"]), card("这个太难了", "Zhège tài nán le."));
assert.deepEqual(Array.from({ length: 5 }, (_, i) => sentence.get(`t${i}`)),
  ["zhè", "ge", "tài", "nán", "le"], "Use saved connected Pinyin rather than liǎo for sentence-final 了");
const bank = learningBuildTileReadings(build("银行", ["了"]), card("银行", "yín háng"));
assert.equal(bank.get("t1"), "háng", "Bank uses háng rather than xíng");
assert.equal(bank.get("t2"), "", "Do not guess an isolated polyphonic distractor");
const grown = learningBuildTileReadings(build("长大"), card("长大", "zhǎng dà"));
assert.equal(grown.get("t0"), "zhǎng", "Contextual polyphonic character");
const fromExample = learningBuildTileReadings(
  { ...build("这个太难了"), kind: "build-sentence" },
  card("难", "nán", [{ source: "这个太难了。", reading: "zhè ge tài nán le", translation: "This is too difficult." }]));
assert.equal(fromExample.get("t4"), "le", "Example reading takes precedence for example reconstruction");
console.log("Learning Pinyin: contextual tile readings, joined saved syllables, polyphones and distractors passed.");

const { suggestChineseReading } = loadTs("src/lib/answerCheck.ts");
assert.equal(suggestChineseReading("gang1cai2", "gāngcái")?.grade, "hard");
assert.equal(suggestChineseReading("yi jing", "yǐjīng")?.grade, "hard");
assert.equal(suggestChineseReading("yǐjīng", "yǐjīng")?.grade, "hard");
assert.equal(suggestChineseReading("已经", "yǐjīng"), null);
assert.equal(suggestChineseReading("qian", "yǐjīng"), null);
assert.equal(suggestChineseReading("lu", "lǜ"), null, "Do not confuse u and ü");
assert.equal(suggestChineseReading("anything", ""), null);
console.log("Chinese production: saved pinyin is partial, not full character recall.");
