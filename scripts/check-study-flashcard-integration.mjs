import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const flashcard = read("src/components/workspace/FlashcardDialog.tsx");
const launcher = read("src/components/StudyModal.tsx");
const cosmos = read("src/components/CosmosWindow.tsx");
const popup = read("src/lib/cosmosWindow.ts");
const topic = read("src/components/PackView.tsx");
const sort = read("src/components/SortModal.tsx");

// Routing behaviour itself is tested in check-languages.mjs.
assert.match(flashcard, /chooseFlashcardDestination\(\{/, "Match the source language before a remembered destination");
assert.match(flashcard, /if \(choice\.pack\) \{ setPackId\(choice\.pack\.id\)/, "Preselect only a same-language topic");
assert.match(flashcard, /await createCard\(pack, values/, "Flashcards must use the normal card persistence path");
assert.match(launcher, /!loading && !error && !templates\.length/, "Failed loading must not look like missing templates");
assert.match(launcher, /aria-label="Number of cards to review"/);
assert.match(launcher, /aria-pressed=\{directionMode === "both"\}/);
assert.match(launcher, /aria-pressed=\{randomOrder\}/);
assert.match(launcher, /mode: "review"/, "Study launches only a Review popup");
assert.match(launcher, /onComplete\(\);/, "A successful review launch notifies the parent");
assert.match(topic, /window.addEventListener\("focus", refreshAfterReview\)/, "Refocus refreshes review statistics");
assert.doesNotMatch(cosmos, /switchMode\("sort"\)/, "The Review window must not expose a second Sort workflow");
assert.doesNotMatch(cosmos, /<button aria-pressed=\{mode === "sort"\}/, "No old Sort tab in flashcard Review");
assert.match(cosmos, /recordStudyEvent\(\{ cardId: card\.id/, "Review records per-card events");
assert.match(topic, /<SortModal pack=/, "The topic-level Sort workflow remains");
assert.match(sort, /function beginSort\(/, "The canonical sorting setup remains usable");
assert.match(popup, /window\.screen\.availHeight/, "Review popup must respect usable display height");
assert.match(popup, /minHeight: Math\.min\(700, height\)/, "Window minimum must not exceed initial height");

console.log("Flashcard language, single Sort, Review setup, grading, accessibility and popup checks passed.");
