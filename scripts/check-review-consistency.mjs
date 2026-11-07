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
assert.doesNotMatch(cosmos, /<RetentionPractice\b/, "Review must not open a separate add-example workflow");
assert.match(cosmos, /if \(mode === "review"\) return null;/, "Review side panels disable adding new content");
assert.match(cosmos, /mode === "sort" \? <button title="Remove relation"/, "Relations are not removable from Review");
assert.match(cosmos, /mode === "sort" \? <button title="Remove"/, "Saved text is not removable from Review");
const exercise = readFileSync("src/components/RetentionPractice.tsx", "utf8");
assert.match(exercise, /signalWorkspaceChange\(userId\)/, "Saved mistakes invalidate other workspace windows");
assert.match(cosmos, /<ConnectionsPanel/, "Connections remains accessible from Review");

// A daily new-card quota of 3 must never cap "Review all" to 3.
// Its exact per-topic selection survives the transition between popup pages.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => { store.set(key, String(value)); },
};
const routeApi = loadTs("src/lib/cosmosWindow.ts", {
  "./platform": { isAndroidRuntime: () => false, openInCurrentApp: () => {} },
});
const route = routeApi.createReviewRoute([
  { packId: "first-topic", cardIds: ["a", "b", "c"] },
  { packId: "next-topic", cardIds: ["d", "e", "f", "g", "h"] },
]);
assert.equal(routeApi.readReviewRoute(route).length, 2);
const nextParams = routeApi.nextReviewRouteParams(route, "first-topic");
assert.equal(nextParams.get("pack"), "next-topic");
assert.equal(nextParams.get("count"), "all");
assert.equal(nextParams.get("route"), route);
assert.deepEqual(routeApi.readReviewSelection("next-topic", nextParams.get("selection")), ["d", "e", "f", "g", "h"]);
assert.equal(routeApi.nextReviewRouteParams(route, "next-topic"), null);
assert.match(readFileSync("src/components/ReviewCentre.tsx", "utf8"), /reviewRouteToken: token/,
  "Review all passes the route token to the popup");
assert.match(cosmos, /nextReviewRouteParams\(config\.reviewRouteToken, pack\.id\)/,
  "The popup advances through every topic in the route");
assert.match(cosmos, /await recordStudyEvent|recordStudyEvent\(/, "Each topic keeps recording grades");

console.log("Multilingual audio and unified targeted Review checks passed.");
