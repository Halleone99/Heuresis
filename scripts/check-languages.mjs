// Behaviour of the shared language identity and of flashcard routing.
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const { languageFromName, languageFromCollection, languageFromScript, chooseFlashcardDestination, languageTone } = loadTs("src/lib/languages.ts");

// Names as people actually write them.
for (const [name, key] of [
  ["Chinese", "zh"], ["Mandarin (HSK 2)", "zh"], ["中文", "zh"], ["汉语 HSK", "zh"],
  ["German", "de"], ["Deutsch B1.2", "de"], ["Russian", "ru"], ["Русский", "ru"], ["русский язык", "ru"],
  ["English", "en"], ["Français", "fr"],
]) assert.equal(languageFromName(name), key, `language of “${name}”`);
for (const name of ["Germanic history", "Grammar", "", null, "Lessons"]) assert.equal(languageFromName(name), null, `no language for “${name}”`);

// Collections fall back to the glyph the Study library shows.
assert.equal(languageFromCollection({ title: "HSK", glyph: "中" }), "zh");
assert.equal(languageFromCollection({ title: "B1", glyph: "Ä" }), "de");
assert.equal(languageFromCollection({ title: "Vocabulary", glyph: "Я" }), "ru");
assert.equal(languageFromCollection({ title: "Misc", glyph: "" }), null);

// Only unambiguous scripts identify a language. Latin text is never guessed.
assert.equal(languageFromScript("下课以后 — after class"), "zh");
assert.equal(languageFromScript("с утра до вечера"), "ru");
assert.equal(languageFromScript("Ich war letzte Woche in der Türkei."), null);
assert.equal(languageFromScript("ひらがなと漢字"), "ja");

const collections = [
  { id: "c-zh", title: "Chinese", glyph: "中" },
  { id: "c-de", title: "Deutsch", glyph: "Ä" },
];
const packs = [
  { id: "p-zh-1", collection_id: "c-zh" }, { id: "p-zh-2", collection_id: "c-zh" },
  { id: "p-de-1", collection_id: "c-de" },
];
// A German note goes to German even though the collection is called "Deutsch".
assert.equal(chooseFlashcardDestination({ subjectName: "German", text: "der Mann", packs, collections }).pack?.id, "p-de-1");
// The remembered topic is reused only when it is in the note's language.
assert.equal(chooseFlashcardDestination({ subjectName: "Chinese", text: "以前", packs, collections, rememberedPackId: "p-zh-2" }).pack?.id, "p-zh-2");
assert.equal(chooseFlashcardDestination({ subjectName: "Chinese", text: "以前", packs, collections, rememberedPackId: "p-de-1" }).pack?.id, "p-zh-1");
// Regression: a Russian note used to default to the first (Chinese) topic.
const russian = chooseFlashcardDestination({ subjectName: "Russian", text: "с утра до вечера", packs, collections, rememberedPackId: "p-de-1" });
assert.equal(russian.pack, null, "Russian note must not be filed in a Chinese or German topic by default");
assert.equal(russian.language, "ru");
// A subject with an unknown name still routes by script.
assert.equal(chooseFlashcardDestination({ subjectName: "Lessons with Liwei", text: "我十八岁", packs, collections }).pack?.id, "p-zh-1");
// A known language must not fall back to the only collection if it differs.
assert.equal(chooseFlashcardDestination({ subjectName: "Russian", text: "да", packs: [packs[0]], collections: [collections[0]] }).pack, null);
// Unknown language with just one available collection keeps the convenience fallback.
assert.equal(chooseFlashcardDestination({ subjectName: "General", text: "hello", packs: [packs[0]], collections: [collections[0]] }).pack?.id, "p-zh-1");
// Exact subject/collection names keep working for languages the table does not know.
assert.equal(chooseFlashcardDestination({ subjectName: "Esperanto", text: "saluton", packs: [...packs, { id: "p-eo", collection_id: "c-eo" }],
  collections: [...collections, { id: "c-eo", title: "Esperanto", glyph: "" }] }).pack?.id, "p-eo");

assert.equal(languageTone("zh"), "cinnabar");
assert.equal(languageTone("de"), "amber");
assert.equal(languageTone("ru"), "indigo");
console.log("Language identity and same-language flashcard routing passed.");
