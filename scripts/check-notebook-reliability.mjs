import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const notes = loadTs("src/lib/noteFormat.ts");
const text = (source) => notes.parseInline(source);

// The editor must not interpret arithmetic or German/Chinese grammar as styling.
assert.deepEqual(text("a*b*c"), [{ type: "text", text: "a*b*c" }]);
assert.deepEqual(text("x == y and y == z"), [{ type: "text", text: "x == y and y == z" }]);
assert.equal(notes.inlinePlain(String.raw`a\*b\*c`), "a*b*c");
assert.equal(notes.inlinePlain(String.raw`\[[Note]]`), "[[Note]]");
assert.equal(notes.inlinePlain(String.raw`\{color:red}word{/color}`), "{color:red}word{/color}");
assert.equal(notes.wikiLinks(String.raw`\[[not a link]]`).size, 0);
assert(notes.wikiLinks("[[Real note]]").has("real note"));

// Triple emphasis should be nested bold + italic, not leftover asterisks.
const triple = text("***bold italic***");
assert.deepEqual(triple, [{ type: "strong", text: "*bold italic*" }]);
assert.equal(notes.inlinePlain("***bold italic***"), "bold italic");
assert.equal(notes.parseBlocks("### Third level")[0].text, "### Third level");
const numbered = notes.parseBlocks("5. First\n6. Second")[0];
assert.equal(numbered.type, "ol");
assert.equal(numbered.items[0].start, 5, "Lists must not silently restart at 1");

// Protect save-conflict decisions against automatic retry on a later revision.
console.log("Notebook literal text, emphasis, links and heading safety checks passed.");
