import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const reader = readFileSync("src/components/workspace/RichText.tsx","utf8");
const page = readFileSync("src/components/workspace/DocumentPage.tsx","utf8");
const css = readFileSync("src/components/workspace/workspace.css","utf8");
const hanzi = "你好，学习中文很有趣。";
const parts = hanzi.split(/(\p{Script=Han}+)/gu);
assert.deepEqual(parts.filter((part) => /\p{Script=Han}/u.test(part)), ["你好", "学习中文很有趣"]);
const eligible = (lines) => lines.length >= 3 && /\p{Script=Han}/u.test(lines[0])
  && !/\p{Script=Han}/u.test(lines[1])
  && /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/iu.test(lines[1]);
assert.ok(eligible(["你好","nǐ hǎo","hello"]));
assert.ok(eligible(["我会说中文","wo hui shuo zhongwen","I speak Chinese"]));
assert.equal(eligible(["你好","nǐ hǎo"]), false);
assert.equal(eligible(["Guten Tag","guten tag","good day"]), false);
assert.equal(eligible(["你好","中国","hello"]), false);
assert.match(reader,/function HanziAware/);
assert.match(reader,/className="nb-hanzi" lang="zh"/);
assert.match(reader,/text\.split\(\/\(\\p\{Script=Han\}\+\)\/gu\)/);
assert.match(reader,/rubyEligible\(group\)/);
assert.match(reader,/<ruby className="nb-ruby-phrase">/);
assert.match(reader,/group\.slice\(showRuby \? 2 : 1\)/);
assert.match(reader,/rubyPinyin=\{rubyPinyin\}/);
assert.match(page,/heuresis\.notebook\.ruby\.v1:/);
assert.match(page,/Pinyin above Hanzi/);
assert.match(page,/aria-pressed=\{rubyPinyin\}/);
assert.match(css,/\.nb-prose \.nb-hanzi \{/);
assert.match(css,/\.nb-ruby-phrase \{ ruby-position: over/);
console.log("Hanzi legibility and opt-in pinyin ruby checks passed.");
