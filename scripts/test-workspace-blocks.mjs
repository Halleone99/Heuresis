import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Execute the standalone, dependency-free parser after TypeScript transpilation.
const source = readFileSync(new URL("../src/lib/workspaceBlocks.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function("exports", code)(exports);
const { parseWorkspaceBlocks, serialiseWorkspaceBlocks, canRoundTripWorkspaceEntry } = exports;

test("legacy text and image notes round-trip unchanged", () => {
  const text = JSON.stringify({ id: "a", type: "text", text: "Older note", dim: "notes", extra: "keep me" });
  const image = JSON.stringify({ id: "b", type: "image", path: "cards/image.png", caption: "Sketch", dim: "components" });
  const blocks = parseWorkspaceBlocks([text, image]);
  assert.deepEqual(blocks.map((block) => block.type), ["text", "image"]);
  assert.deepEqual(serialiseWorkspaceBlocks(blocks), [text, image]);
});

test("Capture v2 specialised notes use their correct panels and preserve metadata", () => {
  const entries = [
    { id: "grammar", schema_version: 2, type: "grammar", text: "Genitive after negation" },
    { id: "parts", schema_version: 2, type: "parts", text: "Prefix + root" },
    { id: "origin", schema_version: 2, type: "origin", text: "Greek root" },
    { id: "fact", schema_version: 2, type: "fact", text: "Used in poetry" },
    { id: "note", schema_version: 2, type: "note", text: "Personal mnemonic" },
  ].map((item) => JSON.stringify(item));
  const blocks = parseWorkspaceBlocks(entries);
  assert.deepEqual(blocks.map((block) => block.dim), ["structure", "components", "origin", "facts", "notes"]);
  assert.deepEqual(serialiseWorkspaceBlocks(blocks), entries);
});

test("Capture examples retain separate source, reading, translation and languages", () => {
  const example = JSON.stringify({
    id: "ex", type: "example", schema_version: 2, source: "我来了",
    reading: "wǒ lái le", translation: "I've arrived", text: "我来了\\nwǒ lái le\\nI've arrived",
    source_language: "zh", translation_language: "en", reading_system: "pinyin",
  });
  const [block] = parseWorkspaceBlocks([example]);
  assert.equal(block.type, "example");
  assert.equal(block.dim, "examples");
  assert.equal(block.source, "我来了");
  assert.equal(block.reading, "wǒ lái le");
  assert.equal(block.translation, "I've arrived");
  assert.deepEqual(serialiseWorkspaceBlocks([block]), [example]);
});

test("unknown and malformed future blocks are not treated as safely editable", () => {
  const future = JSON.stringify({ id: "new", type: "future-v3", text: "Do not lose me" });
  assert.equal(canRoundTripWorkspaceEntry(future), false);
  assert.equal(canRoundTripWorkspaceEntry("not json"), false);
  assert.deepEqual(parseWorkspaceBlocks([future, "not json"]), []);
});

test("new desktop notes serialize and are parsed again", () => {
  const raw = serialiseWorkspaceBlocks([{ id: "new", type: "text", text: "Review this", dim: "structure" }]);
  const [block] = parseWorkspaceBlocks(raw);
  assert.equal(block.text, "Review this");
  assert.equal(block.dim, "structure");
});
