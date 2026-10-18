import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const { readJournalNotes, saveEntryToNotes, removeEntryFromNotes } = loadTs("src/lib/readingJournal.ts");
const original = "My own book notes.\n<!--reading-progress:40/200-->\n<!--reading-meta:%7B%22shelf%22%3A%22next%22%7D-->";
const first = saveEntryToNotes(original, {
  kind: "interesting", text: "A thought I liked", reference: "p. 43", explanation: ""
}, undefined, "entry-1");
assert.equal(readJournalNotes(first).length, 1);
assert.equal(readJournalNotes(first)[0].text, "A thought I liked");
assert.ok(first.includes(original), "Must not erase Personal OS reading metadata or plain notes");
const second = saveEntryToNotes(first, {
  kind: "question", text: "What does this mean?", reference: "ch. 2", explanation: "Discussed with ChatGPT: it means ..."
}, undefined, "entry-2");
assert.deepEqual(readJournalNotes(second).map((x) => x.kind), ["question", "interesting"]);
const edited = saveEntryToNotes(second, {
  kind: "question", text: "My revised question", reference: "ch. 3", explanation: "Now understood"
}, "entry-2");
assert.equal(readJournalNotes(edited).length, 2);
assert.equal(readJournalNotes(edited)[0].explanation, "Now understood");
assert.equal(readJournalNotes(edited)[0].createdAt, readJournalNotes(second)[0].createdAt);
const removed = removeEntryFromNotes(edited, "entry-1");
assert.equal(readJournalNotes(removed).length, 1);
assert.ok(removed.includes(original));
assert.equal(readJournalNotes(removeEntryFromNotes(removed, "entry-2")).length, 0);
assert.throws(() => saveEntryToNotes(original, { kind: "interesting", text: "  ", reference: "", explanation: "" }, undefined, "bad"), /Write something/);
assert.throws(() => removeEntryFromNotes(original, "missing"), /already deleted/);
assert.equal(readJournalNotes("<!--reading-journal:garbled-->").length, 0);
const view = readFileSync("src/components/workspace/ReadingView.tsx", "utf8");
const component = readFileSync("src/components/workspace/ReadingJournal.tsx", "utf8");
assert.match(view, /<ReadingJournal/);
assert.match(component, /api\.addQuote/);
assert.match(component, /api\.saveJournalEntry/);
assert.match(component, /api\.removeJournalEntry/);
console.log("Reading journal persistence and integration checks: OK");
