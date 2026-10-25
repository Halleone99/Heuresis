import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";
const { adoptOwnSaveRevision } = loadTs("src/lib/noteRevision.ts");

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
assert.deepEqual(text("我**很**好"), [{type:"text",text:"我"},{type:"strong",text:"很"},{type:"text",text:"好"}]);
assert.deepEqual(text("**Hinweis:**Text"), [{type:"strong",text:"Hinweis:"},{type:"text",text:"Text"}]);

// Triple emphasis should be nested bold + italic, not leftover asterisks.
const triple = text("***bold italic***");
assert.deepEqual(triple, [{ type: "strong", text: "*bold italic*" }]);
assert.equal(notes.inlinePlain("***bold italic***"), "bold italic");
assert.equal(notes.parseBlocks("### Third level")[0].text, "### Third level");
const numbered = notes.parseBlocks("5. First\n6. Second")[0];
assert.equal(numbered.type, "ol");
assert.equal(numbered.items[0].start, 5, "Lists must not silently restart at 1");

// A previous save may finish while the user types more: do not mistake it for conflict.
const saved = {title:"Deutsch",body:"Ich lerne",topicId:"t1",category:"note",lessonDate:""};
const own = {updated_at:"v2",title:"Deutsch",body:"Ich lerne",topic_id:"t1",kind:"note",category:"note",lesson_date:null};
assert.equal(adoptOwnSaveRevision(own,"v1",saved),"v2","Recognise last autosave");
assert.equal(adoptOwnSaveRevision(own,"v1",saved),"v2","Recognise an offline replay");
assert.equal(adoptOwnSaveRevision({...own,body:"Changed elsewhere"},"v1",saved),"v1");
assert.equal(adoptOwnSaveRevision({...own,category:"grammar"},"v1",saved),"v1");
assert.equal(adoptOwnSaveRevision(null,"v1",saved),"v1");
console.log("Notebook formatting and saved-revision reconciliation checks passed.");
