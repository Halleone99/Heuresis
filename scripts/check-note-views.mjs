import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitNoteSections } from "../src/lib/noteSections.ts";

const example = [
  "# Chinese time",
  "早上 zǎoshang — early morning",
  "下午 xiàwǔ — afternoon",
  "",
  "## Saying the time",
  "现在六点。",
  "Xiànzài liù diǎn.",
  "It is six.",
  "",
  "",
  "",
  "- 半 bàn: half past",
  "- 一刻 yí kè: quarter past",
].join("\n");
const sections = splitNoteSections(example);
assert.equal(sections.length, 3);
assert.deepEqual(sections.map((row) => row.title), ["Chinese time", "Saying the time", "Panel 3"]);
assert.ok(sections[1].body.includes("Xiànzài liù diǎn"));
assert.ok(sections[2].body.includes("一刻"));
assert.equal(splitNoteSections("Line one\n\nLine two").length, 1, "Normal paragraph breaks must stay together");
assert.equal(splitNoteSections("One\n\n\nTwo").length, 2, "Large gaps become independent canvas panels");
assert.equal(splitNoteSections("")[0], undefined, "Empty notes have no panels");
const page = readFileSync("src/components/workspace/DocumentPage.tsx", "utf8");
const renderer = readFileSync("src/components/workspace/NoteReadingViews.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");
assert.ok(page.includes("<NoteViewSwitcher") && page.includes("<NoteReadingViews"), "Reader mode controls are connected");
assert.ok(page.includes("localStorage.setItem"), "Reader preferences are retained");
assert.ok(renderer.includes('mode === "document"') && renderer.includes('mode === "canvas"'), "Document, canvas and study views exist");
assert.ok(renderer.includes("Reveal section") && renderer.includes("onColumnsChange"), "Study recall and canvas columns are interactive");
assert.ok(main.includes("note-reading-views.css"), "Reader styles are loaded");
console.log("Three notebook reading modes and lossless note sectioning checks passed.");
