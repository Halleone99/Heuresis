import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const { cardBarProgress, reviewedSuccessfullyToday, reviewEligible } = loadTs("src/lib/cardProgress.ts", { "./supabase": { supabase: null } });
const DAY = 86_400_000;
const start = Date.UTC(2026, 9, 1, 12);
const events = [];
const add = (day, grade) => events.push({ cardId: "card", templateId: "one", grade, at: start + day * DAY });
function card() {
  const counts = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const event of events) counts[event.grade] += 1;
  return { id: "card", data: {}, stats: { again_count: counts.again, hard_count: counts.hard,
    good_count: counts.good, easy_count: counts.easy, by_template: {}, last_encountered_at: null } };
}
const read = () => cardBarProgress(card(), events, null);

assert.deepEqual(read(), { bars: 0, mastered: false, estimated: false });
add(0, "good");
assert.equal(read().bars, 1);
add(0, "good");
assert.equal(read().bars, 1, "A second success today cannot gain a new bar");
add(0, "again");
assert.equal(read().bars, 0, "Missed removes one bar");
assert.equal(reviewedSuccessfullyToday(events, start + 2 * 60 * 60 * 1000), false, "A miss unlocks same-day retry");
add(0, "hard");
assert.equal(read().bars, 0, "Partial does not move progress");
add(0, "good");
assert.equal(read().bars, 1, "Same-day retry recovers the lost bar");
assert.equal(reviewedSuccessfullyToday(events, start + 2 * 60 * 60 * 1000), true, "Recovered success locks normal review");
add(1, "easy");
assert.equal(read().bars, 4, "Easy reaches Known immediately");
assert.equal(read().mastered, false, "Easy alone cannot master a card");
add(1, "good");
assert.equal(read().mastered, false, "Same-day second confirmation cannot master");
add(2, "good");
assert.equal(read().mastered, true, "Next-day success masters Known");
assert.equal(reviewEligible(read(), events, null, false, start + 3 * DAY), false, "Freshly Mastered cards stay out of normal review");
assert.equal(reviewEligible(read(), events, null, false, start + 183 * DAY), true, "180 days makes a Mastered card eligible");
assert.equal(reviewEligible(read(), events, null, true, start + 3 * DAY), true, "Explicit inclusion overrides automatic exclusions");
add(183, "again");
assert.equal(read().bars, 3, "A mastered miss removes a bar");
assert.equal(read().mastered, false, "A mastered miss removes mastery");
console.log("Review bar rules: one level per day, recovery, Easy, mastery and 180-day eligibility passed.");
