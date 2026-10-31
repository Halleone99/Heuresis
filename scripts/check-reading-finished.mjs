import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const { completedOn, completedInYear, parseFinishedDate, notesWithFinishedYear, sortFinished } = loadTs("src/lib/readingCompletion.ts");
const originalNotes = "My own book notes.\n<!--reading-progress:40/200-->\n<!--reading-meta:%7B%22shelf%22%3A%22next%22%7D-->\n<!--reading-journal:protected-->";

assert.deepEqual(parseFinishedDate("", "2026-10-31"), { exactDate: null, yearOnly: null });
assert.deepEqual(parseFinishedDate("2018", "2026-10-31"), { exactDate: null, yearOnly: "2018" });
assert.deepEqual(parseFinishedDate("2018-04-26", "2026-10-31"), { exactDate: "2018-04-26", yearOnly: null });
assert.deepEqual(parseFinishedDate("2026-10-31", "2026-10-31"), { exactDate: "2026-10-31", yearOnly: null });
for (const invalid of ["2027", "1899", "2018-02-30", "2026-11-01", "2018-13-01", "2018/10", "yesterday"]) {
  assert.throws(() => parseFinishedDate(invalid, "2026-10-31"), /year|date|YYYY/);
}
const stamped = notesWithFinishedYear(originalNotes, "2018");
assert.ok(stamped.includes(originalNotes), "Adding a year cannot erase original notes, journal or progress");
assert.equal(completedOn({ finishDate: "", notes: stamped }), "2018");
assert.equal(completedInYear({ finishDate: "", notes: stamped }, 2018), true);
assert.equal(completedInYear({ finishDate: "", notes: stamped }, 2026), false);
assert.equal(completedOn({ finishDate: "2026-09-01", notes: originalNotes }), "2026-09-01");
assert.equal(completedOn({ finishDate: "", notes: originalNotes }), "");
const moved = notesWithFinishedYear(stamped, "2020");
assert.equal(completedOn({ finishDate: "", notes: moved }), "2020");
assert.equal((moved.match(/reading-finished-year/g) ?? []).length, 1, "Must not accumulate repeated years");
assert.equal(notesWithFinishedYear(stamped, null).trim(), originalNotes, "Removing completion should preserve existing notes");

const books = [
  { title: "Unknown", finishDate: "", notes: originalNotes },
  { title: "Recent", finishDate: "2026-08-01", notes: originalNotes },
  { title: "Old", finishDate: "", notes: stamped },
];
books.sort((a, b) => sortFinished(a, b));
assert.deepEqual(books.map(book => book.title), ["Recent", "Old", "Unknown"]);

const reading = readFileSync("src/components/workspace/ReadingView.tsx", "utf8");
const bridge = readFileSync("src/lib/readingBridge.ts", "utf8");
const quotes = readFileSync("src/components/workspace/QuotationsView.tsx", "utf8");
assert.match(reading, /catalogue: api\.books\.filter\(\(book\) => book\.status !== "Read"\)\.length/);
assert.match(reading, /tab === "catalogue" && book\.status === "Read"/);
assert.match(reading, /tab === "finished" && book\.status !== "Read"/);
assert.match(reading, /lit-finished-list/);
assert.match(reading, /onClick=\{\(\) => openBook\(book\)\}/);
assert.match(reading, /onClick=\{\(\) => openQuotations\(book\.id\)\}/);
assert.match(reading, /completedInYear\(book, currentYear\)/);
assert.match(reading, /Date finished \(optional\)/);
assert.match(reading, /"Add finished book"/);
assert.doesNotMatch(reading, /status === "Read" \? \{ finishDate: new Date/);
assert.match(bridge, /finish_date: completion\.exactDate/);
assert.match(bridge, /notesWithFinishedYear\("", completion\.yearOnly\)/);
assert.match(bridge, /updated_at", row\.updated_at/);
assert.match(quotes, /readingId: selected\?\.readingId \?\? null/);
console.log("Finished Reading archive, date precision, counts, note safety and quotation navigation — OK");
