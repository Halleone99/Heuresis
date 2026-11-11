// Acceptance checks for the current New → Learn → Review phase contract.
// Scoring is now tested in the five-exercise round tests, not in card metadata.
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

let saved = null;
const stage = loadTs("src/lib/learningStage.ts", {
  "./heuresis": {
    patchCardData: async (_cardId, patch) => {
      saved = patch;
      return { term: "die Entwicklung", ...patch };
    },
  },
});

const {
  readAcquisition, enterLearning, enterReview, legacyReady,
  legacyExerciseTimes, suggestRelearning, saveAcquisition,
  inLearning, inReview, LEARNING_STAGE_KEY,
} = stage;
const card = { id: "same-card", data: { term: "die Entwicklung" } };

assert.equal(inReview(card), true, "Existing cards remain in Review");
assert.equal(inLearning(card), false);
const initial = readAcquisition(card.data);
assert.equal(initial.phase, "review");
assert.equal(initial.cycle, 0);

const learning = enterLearning(initial, "new");
assert.equal(learning.phase, "learning");
assert.equal(learning.cycle, 1);
assert.deepEqual(learning.completed, [], "New rounds have no legacy completions");
assert.equal(learning.history.at(-1).kind, "enter_learning");
assert.equal(learning.history.at(-1).reason, "new");

const learningCard = { ...card, data: { ...card.data, [LEARNING_STAGE_KEY]: JSON.stringify(learning) } };
assert.equal(inLearning(learningCard), true);
const savedCard = await saveAcquisition(learningCard, learning);
assert.equal(savedCard.id, card.id, "The card keeps its identity");
assert.equal(typeof saved[LEARNING_STAGE_KEY], "string");
assert.equal(readAcquisition(savedCard.data).phase, "learning", "Phase survives serialisation");

const graduated = enterReview(learning, "ready");
assert.equal(graduated.phase, "review");
assert.equal(graduated.history.at(-1).kind, "enter_review");
assert.equal(graduated.history.at(-1).reason, "ready");
assert.equal(graduated.history.length, learning.history.length + 1);
const direct = enterReview(initial, "direct");
assert.equal(direct.phase, "review");
assert.equal(direct.history.at(-1).reason, "direct", "Direct New → Review is not a review grade");

const returned = enterLearning(graduated, "relearn");
assert.equal(returned.cycle, 2);
assert.equal(returned.phase, "learning");
assert.deepEqual(returned.completed, []);
assert.equal(returned.history.length, graduated.history.length + 1);
assert.equal(returned.history.at(-1).reason, "relearn");

const legacyExercises = [
  "typing", "handwriting", "reconstruct", "missing", "meaning",
  "context", "pronunciation", "contrast", "sentence", "association",
];
const legacy = readAcquisition({
  [LEARNING_STAGE_KEY]: JSON.stringify({
    phase: "learning", cycle: 1, completed: legacyExercises,
    history: legacyExercises.map((exercise) => ({
      at: "2026-10-01T12:00:00.000Z", cycle: 1, kind: "exercise", exercise,
    })),
  }),
});
assert.equal(legacyReady(legacy), true, "Previously completed ten-exercise cards retain readiness");
assert.equal(legacyExerciseTimes(legacy).length, 10, "Earlier exercise history remains readable");
assert.equal(legacyReady(enterLearning(legacy, "relearn")), false, "A new cycle resets legacy readiness");

assert.equal(suggestRelearning([{ grade: "good" }, { grade: "again" }, { grade: "hard" }]), true);
assert.equal(suggestRelearning([{ grade: "good" }, { grade: "again" }]), false);
assert.equal(readAcquisition({ [LEARNING_STAGE_KEY]: "{bad json" }).phase, "review");
console.log("Learning stage invariants: passed");
