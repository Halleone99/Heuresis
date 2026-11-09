// Acceptance tests for the real acquisition state implementation, without the Supabase network.
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
  readAcquisition, enterInitialLearning, bypassAcquisition, awardExercise,
  acquisitionScore, acquisitionReady, finishAcquisition, suggestRelearning,
  saveAcquisition, inLearning, inReview, LEARNING_STAGE_KEY, EXERCISE_IDS,
} = stage;
const card = { id: "same-card", data: { term: "die Entwicklung" } };

assert.equal(inReview(card), true, "Legacy card remains in Review");
assert.equal(inLearning(card), false);
const bypassed = bypassAcquisition(readAcquisition(card.data));
assert.equal(bypassed.phase, "review");
assert.equal(bypassed.completed.length, 0);
assert.equal(bypassed.history[0].kind, "enter_review", "A bypass is not a successful review grade");

let learning = enterInitialLearning(readAcquisition(card.data));
assert.equal(learning.phase, "learning");
assert.equal(acquisitionScore(learning), 0);
assert.equal(learning.cycle, 1);
for (const exercise of EXERCISE_IDS) {
  learning = awardExercise(learning, exercise, exercise === "typing" ? "automatic" : "self", "Completed sample");
}
assert.equal(EXERCISE_IDS.length, 10, "Ten exercise types offer a maximum of 100 points");
assert.equal(acquisitionScore(learning), 100);
assert.equal(acquisitionReady(learning), true);
const duplicate = awardExercise(learning, "typing", "automatic", "Repeated");
assert.deepEqual(duplicate, learning, "Each exercise type earns +10 only once per cycle");
assert.equal(learning.history.filter((event) => event.kind === "exercise").length, 10);
const readyCard = { ...card, data: { ...card.data, [LEARNING_STAGE_KEY]: JSON.stringify(learning) } };
assert.equal(inLearning(readyCard), true);
const savedCard = await saveAcquisition(readyCard, learning);
assert.equal(savedCard.id, card.id, "Same card identity");
assert.equal(typeof saved[LEARNING_STAGE_KEY], "string");
assert.equal(acquisitionScore(readAcquisition(savedCard.data)), 100, "Progress survives serialisation");

const graduated = finishAcquisition(learning);
assert.equal(graduated.phase, "review");
assert.equal(graduated.history.at(-1).kind, "enter_review");
assert.throws(() => finishAcquisition(enterInitialLearning(readAcquisition(card.data))), /Complete all ten/);

const returned = enterInitialLearning(graduated);
assert.equal(returned.cycle, 2);
assert.equal(returned.phase, "learning");
assert.equal(acquisitionScore(returned), 0, "Only current preparation points reset");
assert.equal(returned.history.length, graduated.history.length + 1, "Earlier exercise/transition history preserved");
assert.equal(suggestRelearning([{ grade: "good" }, { grade: "again" }, { grade: "hard" }]), true);
assert.equal(suggestRelearning([{ grade: "good" }, { grade: "again" }]), false);
assert.equal(stage.readAcquisition({ [LEARNING_STAGE_KEY]: "{bad json" }).phase, "review");
console.log("Learning stage invariants: passed");
