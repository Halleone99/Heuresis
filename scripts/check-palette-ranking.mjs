// The Ctrl+K palette: which group comes first, so Enter does what was typed.
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const { commandScore, resultsFirst, foldForSearch } = loadTs("src/lib/paletteRanking.ts");
const command = (label, detail = "", keywords = "") => ({ label, detail, keywords });
const words = (query) => foldForSearch(query).split(" ").filter(Boolean);

assert.equal(foldForSearch("Xiàkè  YǏHÒU"), "xiake yihou", "pinyin tone marks and case are ignored");
assert.equal(foldForSearch("Türkei"), "turkei");

const exportCommand = command("Export Notebook as JSON", "Download your Notebook and recall history", "backup archive download");
assert.equal(commandScore(exportCommand, words("export")), 50, "label prefix");
assert.equal(commandScore(exportCommand, words("json")), 40, "label word");
assert.equal(commandScore(exportCommand, words("backup")), 5, "keyword only");
assert.equal(commandScore(exportCommand, words("grammar")), 0, "no match");
assert.equal(commandScore(exportCommand, []), 1, "every command is listed for an empty query");

// Notes score 10 + 25 (title contains the words) + 10 (title starts with them) in WorkspaceSearch.
const strongTitle = 45;
assert.equal(resultsFirst(commandScore(command("Capture a note"), words("note")), strongTitle, true), true,
  "a note whose title matches beats a command that only contains the word");
assert.equal(resultsFirst(commandScore(command("Sync now"), words("sync")), 10, true), false,
  "a command named by the query stays first when notes merely mention it");
assert.equal(resultsFirst(5, 10, true), true, "notes beat a keyword-only command");
assert.equal(resultsFirst(1, 0, false), false, "with an empty query actions come first");
console.log("Command palette ranking passed.");
