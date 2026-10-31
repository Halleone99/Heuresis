// Regression checks for multilingual Review audio and shared filtered sessions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const audio = loadTs("src/lib/reviewAudio.ts", {});
const lang = (text, topic, role) => audio.reviewSpeechLanguage(text, topic, "", role);
assert.equal(lang("懂", "Core HSK", "term"), "zh-CN", "Chinese characters have Chinese audio");
assert.equal(lang("Я понимаю", "Russian", "term"), "ru-RU", "Cyrillic has Russian audio");
assert.equal(lang("verstehen", "German B1", "term"), "de-DE", "German vocabulary has German audio");
assert.equal(lang("understand", "German B1", "meaning"), "en-GB", "English glosses stay English");
assert.equal(lang("the", "Core HSK", "meaning"), "en-GB", "A Chinese pack must not pronounce the English prompt as Chinese");
assert.equal(lang("bonjour", "French", "term"), "fr-FR");
assert.deepEqual(audio.reviewSpokenPrompt(["term","reading"], {term:"高",reading:"gāo"}, "reading"), {key:"term",text:"高"});
assert.deepEqual(audio.reviewSpokenPrompt(["meaning"], {term:"高",meaning:"tall"}, "reading"), {key:"meaning",text:"tall"});
assert.equal(audio.reviewSpokenPrompt(["reading"], {reading:"gāo"}, "reading"), null, "Reading-only prompts must not be spoken as hidden answers");

const cosmos = readFileSync("src/components/CosmosWindow.tsx","utf8");
const topic = readFileSync("src/components/PackView.tsx","utf8");
const popup = readFileSync("src/lib/cosmosWindow.ts","utf8");
assert.match(topic, /cardIds: next\.map\(\(card\) => card\.id\)/, "Targeted review passes exact selected cards");
assert.doesNotMatch(topic, /<CatalogueSession[^>]+mode="review"/, "Topic must not launch the obsolete review experience");
assert.match(popup, /params\.set\("selection", token\)/, "Selection travels to the review window");
assert.match(cosmos, /readReviewSelection\(config\.packId, config\.selectionToken\)/, "Selected card IDs are honoured in Review");
assert.match(cosmos, /reviewSpeechLanguage\(/, "Review uses locale-aware TTS");
assert.match(cosmos, /\["hear","Hear"\]/, "Hear appears as the fifth exclusive answer method");
assert.match(cosmos, /method !== "hear"/, "Audio-first prompts only play in Hear mode");
assert.match(cosmos, /Said aloud/, "Spoken confirmation remains explicit");
assert.doesNotMatch(cosmos, /heuresis\.review\.audioPrompt\.v1/, "Separate Listen switch has been removed");
const exercise = readFileSync("src/components/RetentionPractice.tsx", "utf8");
assert.match(exercise, /Type example/, "Review exposes a typed example exercise");
assert.match(exercise, /checkCaptureText\(submitted, pack\.title, "exercise", target\)/, "Typed examples receive contextual AI checking");
assert.match(exercise, /Add to Mistake Log/, "Learners can file an actual correction");
assert.match(exercise, /signalWorkspaceChange\(userId\)/, "Saved mistakes invalidate other workspace windows");
assert.match(cosmos, /<ConnectionsPanel/, "Connections remains accessible from Review");
console.log("Multilingual audio and unified targeted Review checks passed.");
