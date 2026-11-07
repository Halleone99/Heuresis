import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

// Use the production eligibility and overview functions, not a copy of their rules.
const progress = loadTs("src/lib/cardProgress.ts");
const now = Date.UTC(2026, 10, 7, 12);
const grades = [{ cardId: "reviewed", templateId: "front", grade: "good", at: now - 1_000 }];
const cards = [
  { id: "reviewed", data: { _sorted_at: "2026-11-06T12:00:00Z" }, stats: { study_count: 1, again_count: 0, hard_count: 0, good_count: 1, easy_count: 0, by_template: {}, last_encountered_at: null } },
  { id: "waiting", data: { _sorted_at: "2026-11-06T12:00:00Z" }, stats: { study_count: 0, again_count: 0, hard_count: 0, good_count: 0, easy_count: 0, by_template: {}, last_encountered_at: null } },
];
let historyAvailable = true;
const templates = [
  { id: "front", name: "Front", front: ["term"], back: ["meaning"] },
  { id: "back", name: "Back", front: ["meaning"], back: ["term"] },
];
const overview = loadTs("src/lib/reviewOverview.ts", {
  "./heuresis": { listCards: async () => cards },
  "./reviewEvidence": { loadGradeEvents: async () => historyAvailable ? grades : null },
  "./recommend": { defaultDirections: () => templates },
  "./study": { loadStudySetup: async () => ({ templates, defaultTemplateId: "front" }) },
  "./sort": { cardHasCompletedSort: (card) => Boolean(card.data._sorted_at), SORTED_AT_KEY: "_sorted_at" },
  "./knowledgeState": { assessState: () => ({ state: null }), directionEvidence: () => ({}) },
  "./cardProgress": progress,
});
const packs = [{ id: "topic", card_count: 2, card_type_id: "type" }];
const today = await overview.loadReviewOverview(packs, now);
assert.equal(today.ready, 1, "Successfully reviewed card is removed from today's queue");
assert.deepEqual(today.topics.topic.readyCardIds, ["waiting"]);
assert.equal(today.reviewedToday, 1, "A persisted success is counted as completed today");
assert.equal(today.reverseTomorrow, 1, "The reverse direction is held until the next day");
const tomorrow = await overview.loadReviewOverview(packs, now + 86_400_000);
assert.equal(tomorrow.ready, 2, "The reverse direction becomes available tomorrow");
historyAvailable = false;
const unavailable = await overview.loadReviewOverview(packs, now);
assert.equal(unavailable.ready, 0, "Missing review history must not falsely show cards as ready");
assert.equal(unavailable.incomplete, true, "Unverified review history is explicit");

// When a write has reached the server but remains in the local queue briefly,
// the evidence loader must count it once, not as two review attempts.
const saved = { client_event_id: "event-123", card_id: "reviewed", template_id: "front", event_type: "good", created_at: new Date(now - 1_000).toISOString() };
const client = {
  from(table) {
    assert.equal(table, "heuresis_card_events");
    return { select(selection) {
      assert.match(selection, /client_event_id/);
      return { eq() { return this; }, in() { return this; }, order() { return this; },
        async range() { return { data: [saved], error: null }; } };
    } };
  },
};
const evidence = loadTs("src/lib/reviewEvidence.ts", {
  "./supabase": { supabase: client },
  "./study": { pendingStudyGrades: () => [saved] },
});
const merged = await evidence.loadGradeEvents("topic");
assert.equal(merged.length, 1, "Pending and acknowledged grades are merged by client event ID");

const cosmos = readFileSync("src/components/CosmosWindow.tsx", "utf8");
const launcher = readFileSync("src/components/StudyModal.tsx", "utf8");
const library = readFileSync("src/components/LibraryView.tsx", "utf8");
assert.doesNotMatch(cosmos, /deliberateSelection/, "Targeted reviews must not override same-day completion");
assert.doesNotMatch(launcher, /tagIds\.length > 0 \|\| flags\.length > 0\);/, "Tag filters must not unlock reviewed cards");
assert.match(library, /newCardQuota <= 1/, "New card quota can be set to exactly one");
assert.match(library, /id="library-new-tag"/, "New cards must have an explicit tag selector");
assert.match(library, /newTagId \? cards\.filter/, "Selected new-card tag must affect the actual sort queue");
console.log("Daily review persistence, next-day direction, tag and one-card quota checks passed.");
