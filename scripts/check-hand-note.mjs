// Handwriting format: old drawings still read, new ones are compact and survive
// the note parser and the editor's serialiser unchanged.
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const ink = loadTs("src/lib/handNote.ts");
const { parseBlocks } = loadTs("src/lib/noteFormat.ts");

// 1. A version 1 drawing exactly as the old Quick Capture saved it.
const v1 = ink.HAND_NOTE_PREFIX + Buffer.from(JSON.stringify({ version: 1, strokes: [
  { d: "M10 20 L30 40 L50 45", color: "#2563eb" },
  { d: "M100 100 L100 100", color: "#202938" },
] })).toString("base64");
const old = ink.decodeHandNote(v1);
assert.equal(old.strokes.length, 2, "version 1 drawings still open");
assert.deepEqual(old.strokes[0], { tool: "pen", colour: 1, size: 1, points: [10, 20, 30, 40, 50, 45] }, "old colour and points are kept");
assert.equal(old.height, 700);
assert.equal(ink.decodeHandNote(v1.slice(ink.HAND_NOTE_PREFIX.length)).strokes.length, 2, "the payload alone decodes too");

// 2. Version 2 round trip: tools, colours, sizes, paper and height.
const note = { height: 1400, paper: "lines", strokes: [
  { tool: "pen", colour: 2, size: 0, points: [5, 5, 120, 80, 240, 66] },
  { tool: "marker", colour: 3, size: 2, points: [10, 900, 880, 905] },
  { tool: "pen", colour: 0, size: 2, points: [450, 1300] },
] };
const line = ink.encodeHandNote(note);
assert.ok(line.startsWith(ink.HAND_NOTE_PREFIX), "same line prefix, so every existing reader still finds it");
assert.match(line.slice(ink.HAND_NOTE_PREFIX.length), /^[A-Za-z0-9+/=]+$/, "payload stays plain base64");
assert.deepEqual(ink.decodeHandNote(line), note, "version 2 round trip is exact");
assert.deepEqual(parseBlocks(`Lesson\n\n${line}\n\nAfter`).map((block) => block.type), ["p", "p", "handnote", "p", "p"],
  "the note parser keeps a version 2 drawing as its own block");

// 3. Damaged or hostile data never throws and never escapes the page.
assert.equal(ink.decodeHandNote("::handnote:v1:%%%").strokes.length, 0);
const hostile = ink.HAND_NOTE_PREFIX + Buffer.from(JSON.stringify({ v: 2, h: 99999, p: "<svg>", s: [
  [0, 99, 7, -50, 5000, 1, 1], [0, 0, 0, 1.5, 2], "nope", [1, 0, 0, 10, 10, 5, 5],
] })).toString("base64");
const safe = ink.decodeHandNote(hostile);
assert.equal(safe.height, ink.HAND_NOTE_MAX_HEIGHT, "height is capped");
assert.equal(safe.paper, "plain", "unknown paper falls back to plain");
assert.equal(safe.strokes.length, 2, "malformed strokes are skipped, valid ones kept");
assert.deepEqual(safe.strokes[0], { tool: "pen", colour: 0, size: 1, points: [0, 5000, 0, 5001] }, "points are clamped and indices repaired");
assert.ok(!ink.handNoteSvgMarkup(safe).includes("<svg>"), "markup never echoes raw input");

// 4. Size: a dense page of handwriting stays well inside a 50,000-character note.
const strokes = [];
let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// Handwriting-like strokes: smooth arcs 25–90 units long, sampled every 1.5 units
// as a stylus reports them, with a little sensor noise; 450 strokes is about
// sixty Chinese characters, a full page of lesson notes.
for (let s = 0; s < 450; s++) {
  const points = [];
  let x = 20 + random() * 860, y = 20 + random() * 1300;
  let angle = random() * Math.PI * 2;
  const bend = (random() - .5) * .08, length = 25 + random() * 65;
  for (let travelled = 0; travelled < length; travelled += 1.5) {
    angle += bend; x += Math.cos(angle) * 1.5; y += Math.sin(angle) * 1.5;
    points.push(x + (random() - .5) * .6, y + (random() - .5) * .6);
  }
  strokes.push({ tool: "pen", colour: 0, size: 1, points: ink.simplifyPoints(points).map(Math.round) });
}
const page = ink.encodeHandNote({ height: 1400, paper: "plain", strokes });
const legacySize = ink.HAND_NOTE_PREFIX.length + Buffer.from(JSON.stringify({ version: 1, strokes: ink.legacyStrokes({ height: 1400, paper: "plain", strokes }) })).toString("base64").length;
assert.ok(page.length < 45000, `450 strokes encode to ${page.length} characters`);
assert.ok(page.length < legacySize * .7, `version 2 is at least 30% smaller than version 1 (${page.length} vs ${legacySize})`);

// 5. Geometry used by the pad.
assert.deepEqual(ink.simplifyPoints([0, 0, 1, 0.1, 2, 0, 3, 0.05, 4, 0]), [0, 0, 4, 0], "near-straight runs collapse");
assert.deepEqual(ink.simplifyPoints([0, 0, 10, 10, 20, 0]), [0, 0, 10, 10, 20, 0], "corners stay");
assert.equal(ink.smoothPath([1, 2]), "M1 2L1 2", "a dot is drawable");
assert.match(ink.smoothPath([0, 0, 10, 10, 20, 0, 30, 10]), /^M0 0Q10 10 15 5Q20 0 25 5L30 10$/, "curves run through midpoints");
const strokeA = { tool: "pen", colour: 0, size: 1, points: [0, 0, 100, 0] };
assert.ok(ink.strokeHit(strokeA, 50, 8, 7), "the eraser catches a stroke it touches");
assert.ok(!ink.strokeHit(strokeA, 50, 20, 7), "and leaves one it does not");
assert.ok(ink.strokeHit({ tool: "marker", colour: 0, size: 2, points: [0, 0, 100, 0] }, 50, 20, 7), "wide highlighter strokes are easier to hit");

// 6. The retired capture panel's conversions.
assert.deepEqual(ink.legacyStrokes(ink.handNoteFromLegacy([{ d: "M1 2 L3 4", color: "#c2410c" }])), [{ d: "M1 2 L3 4", color: "#c2410c" }]);

console.log(`Handwriting format: v1 compatibility, v2 round trip, hostile input, size (${page.length} chars for 450 strokes; version 1 would need ${legacySize}) and geometry passed.`);
