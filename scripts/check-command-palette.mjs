// Wiring of the Ctrl+K palette. Ranking behaviour: check-palette-ranking.mjs.
// Keyboard and click behaviour in a real browser: verification/tests/regressions.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync("src/App.tsx", "utf8");
const palette = readFileSync("src/components/workspace/WorkspaceSearch.tsx", "utf8");

assert.match(palette, /export type PaletteCommand =/, "Typed commands are exposed");
assert.match(palette, /commandScore\(command, words\)/, "Commands are matched and scored as typed");
assert.match(palette, /const rows: Row\[\] =/, "One ordered row list drives keyboard and click selection");
assert.match(palette, /const row = rows\[index\];/, "Enter opens exactly the highlighted row");
assert.match(palette, /row\.command\.run\(\)/, "Commands have actual callbacks");
assert.match(palette, /onSearchCards\(query\.trim\(\)\)/, "Study card search remains available");
assert.match(palette, /event\.nativeEvent\.isComposing \|\| event\.keyCode === 229/, "IME composition keys are not stolen");
assert.match(palette, /role: "option"/, "Actions and results expose listbox options");
assert.match(app, /commands=\{paletteCommands\}/, "App passes live command functions");
assert.match(app, /const paletteCommands: PaletteCommand\[\] =/, "Commands are defined in app shell");
for (const id of ["capture-note","capture-mistake","practise-mistakes","organise-inbox","settings","sidebar","focus","sync","trash","export"]) {
  assert.ok(app.includes(`id: "${id}"`), `Missing command: ${id}`);
}
assert.match(app, /workspace\.openMistake\(eligible\[0\]\.id, \{ practise: true, ids: eligible\.map/, "Mistake review opens a full correction session");
assert.match(app, /const topicId = inboxForContext\(\);/, "Inbox clean-up uses the current language, not the first Inbox");
assert.match(app, /await exportKnowledgeJson\(session\.user\.id\)/, "Export reads the signed-in user's Notebook");
assert.match(app, /anchor\.download =/, "Export is a real download");
assert.doesNotMatch(app, /if \(section === "study"\) setSearchOpen\(true\); else openPalette\(\);/, "Ctrl+K must not have competing searches");
assert.match(app, /if \(mod && !event\.shiftKey && !event\.altKey && event\.code === "KeyK"\)/, "Ctrl+K opens the command menu");
assert.match(app, /if \(!modalOpen\(\)\) openPalette\(\);/, "Ctrl+K does not open underneath another dialog");

console.log("Unified command menu wiring passed.");
