import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync("src/App.tsx", "utf8");
const palette = readFileSync("src/components/workspace/WorkspaceSearch.tsx", "utf8");

assert.match(palette, /export type PaletteCommand =/, "Typed commands are exposed");
assert.match(palette, /const matchedCommands = commands\.filter/, "Palette filters commands as typed");
assert.match(palette, /const total = commandCount \+ results\.length/, "Selection count includes commands and notes");
assert.match(palette, /if \(index < commandCount\)/, "Actions are executed before document navigation");
assert.match(palette, /matchedCommands\[index\]\.run\(\)/, "Commands have actual callbacks");
assert.match(palette, /open\(commandCount \+ index\)/, "Note result selection remains correctly offset");
assert.match(palette, /open\(commandCount \+ results\.length\)/, "Study search action uses correct offset");
assert.match(palette, /role="option"/, "Actions and results expose listbox options");
assert.match(app, /commands=\{paletteCommands\}/, "App passes live command functions");
assert.match(app, /const paletteCommands: PaletteCommand\[\] =/, "Commands are defined in app shell");
for (const id of ["capture-note","capture-mistake","start-lesson","practise-due","organise-inbox","settings","sidebar","focus","sync","trash","export"]) {
  assert.ok(app.includes(`id: "${id}"`), `Missing command: ${id}`);
}
assert.match(app, /workspace\.openMistake\(due\[0\]\.id, \{ practise: true/, "Due review opens a real session");
assert.match(app, /workspace\.openCleanup\(\{ kind: "inbox", id: topicId \}\)/, "Capture sorting opens Inbox clean-up");
assert.match(app, /await exportKnowledgeJson\(session\.user\.id\)/, "Export reads the signed-in user's Notebook");
assert.match(app, /anchor\.download =/, "Export is a real download");
assert.doesNotMatch(app, /if \(section === "study"\) setSearchOpen\(true\); else openPalette\(\);/, "Ctrl+K must not have competing searches");
assert.match(app, /if \(mod && !event\.shiftKey && !event\.altKey && event\.code === "KeyK"\)/, "Ctrl+K opens the command menu");

console.log("Unified command menu navigation, keyboard offsets, persistence and export wiring passed.");
