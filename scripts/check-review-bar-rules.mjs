import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./lib/load-ts.mjs";

const { cardBarProgress, reviewedSuccessfullyToday, reviewEligible, reviewEligibleForMode, MASTERY_MAINTENANCE_SINCE } = loadTs("src/lib/cardProgress.ts", { "./supabase": { supabase: null } });
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
assert.equal(reviewEligibleForMode(read(), events, null, false, start), true, "Unmastered cards enter ordinary Review");
assert.equal(reviewEligibleForMode(read(), events, null, true, start), false, "Unmastered cards never enter Review mastered");
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
assert.equal(reviewEligibleForMode(read(), events, null, false, start + 3 * DAY), false, "Mastered cards do not enter ordinary Review before their due date");
assert.equal(reviewEligibleForMode(read(), events, null, true, start + 3 * DAY), true, "Only Mastered cards enter Review mastered");
assert.equal(reviewEligibleForMode(read(), events, null, true, start + 2 * DAY), false, "Freshly mastered cards cannot be practised twice today");
assert.equal(reviewEligible(read(), events, null, false, start + 3 * DAY), false, "Freshly Mastered cards stay out of normal review");
assert.equal(reviewEligible(read(), events, null, false, start + 183 * DAY), true, "Overdue Mastered cards enter ordinary Review");
assert.equal(reviewEligible(read(), events, null, false, start + 365 * DAY), true, "Overdue Mastered cards remain due until reviewed");
assert.equal(reviewEligible(read(), events, null, true, start + 3 * DAY), true, "Explicit inclusion overrides automatic exclusions");
assert.equal(reviewEligible(read(), events, null, true, start + 2 * DAY), false, "Include Mastered does not bypass the same-day success lock");
add(183, "again");
assert.equal(read().bars, 3, "A mastered miss removes a bar");
assert.equal(read().mastered, false, "A mastered miss removes mastery");
assert.equal(reviewEligibleForMode(read(), events, null, true, start + 184 * DAY), false, "Lost mastery removes a card from mastered-only practice");
add(183, "good");
assert.equal(read().bars, 4, "Same-day recovery returns to Known");
add(183, "good");
assert.equal(read().mastered, false, "Cannot re-master on the recovery day");
add(184, "good");
assert.equal(read().mastered, true, "A separate day's confirmation restores mastery");
// New reversible cards: neither side alone earns progress, including across sessions.
const pair = ["russian-to-english", "english-to-russian"];
const modern = Date.UTC(2026, 10, 2, 12);
const pairedEvents = [];
const pairedCard = () => {
  const counts = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const e of pairedEvents) counts[e.grade] += 1;
  return { id: "paired", data: {}, stats: { again_count: counts.again, hard_count: counts.hard,
    good_count: counts.good, easy_count: counts.easy, by_template: {}, last_encountered_at: null } };
};
const record = (day, side, grade) => pairedEvents.push({ cardId: "paired", templateId: pair[side], grade, at: modern + day * DAY });
const paired = (day) => cardBarProgress(pairedCard(), pairedEvents, null, pair, modern + day * DAY + 1);
record(0, 0, "good");
assert.equal(paired(0).bars, 0, "Recognition alone cannot earn a bar");
assert.deepEqual(paired(0).pendingDirections, [pair[0]], "First direction is saved across sessions");
assert.equal(reviewEligible(paired(0), pairedEvents, null, false, modern + 1, pair), false, "A successful first side finishes the card for today");
assert.equal(reviewEligible(paired(0), pairedEvents, null, false, modern + DAY + 1, pair), true, "The opposite side becomes available tomorrow");
assert.equal(reviewEligible(paired(0), pairedEvents, null, false, modern + 1, [pair[0]]), false, "An already passed side is not repeated unnecessarily");
record(1, 1, "good");
assert.equal(paired(1).bars, 1, "Production on the following day completes the pair");
assert.deepEqual(paired(1).pendingDirections, [], "A completed pair resets its pending sides");
assert.equal(paired(1).completedToday, true);
assert.equal(reviewEligible(paired(1), pairedEvents, null, false, modern + DAY + 1, pair), false, "A completed pair locks normal same-day review");
record(1, 0, "good");
record(1, 1, "good");
assert.equal(paired(1).bars, 1, "Repeated same-day pairs cannot farm progress");
record(2, 0, "easy");
assert.equal(paired(2).bars, 1, "Easy is pending until the opposite direction is correct");
record(2, 1, "hard");
assert.equal(paired(2).bars, 1, "Partial does not complete the pair");
record(2, 1, "good");
assert.equal(paired(2).bars, 4, "Easy on either side plus a successful opposite side jumps to four bars");
assert.equal(paired(2).mastered, false, "Easy alone does not grant Mastered");
record(3, 1, "good");
record(3, 0, "again");
assert.equal(paired(3).bars, 3, "A miss still removes a bar and invalidates only that pending direction");
record(3, 0, "good");
assert.equal(paired(3).bars, 4, "Recovering both sides restores the lost bar, not Mastered");
record(4, 0, "good");
record(4, 1, "good");
assert.equal(paired(4).mastered, true, "Another day's confirmed pair can grant Mastered");
assert.equal(reviewEligible(paired(4), pairedEvents, null, false, modern + 4 * DAY + 1, pair), false, "A completed Mastered card stays out");
// Maintenance is a separate, durable hierarchy; timestamps are explicit.
const base = MASTERY_MAINTENANCE_SINCE + 3 * DAY;
function fixture(id, directions = []) {
  const grades = [];
  const stats = { again_count: 0, hard_count: 0, good_count: 0, easy_count: 0, by_template: {}, last_encountered_at: null };
  const c = { id, data: {}, stats };
  return {
    grades,
    add(at, grade, templateId = "one") { grades.push({ cardId: id, templateId, grade, at }); stats[grade + "_count"]++; },
    read(now) { return cardBarProgress(c, grades, null, directions, now); },
    eligible(now, only = false) { return reviewEligibleForMode(this.read(now), grades, null, only, now, directions); },
  };
}
const m = fixture("maintenance");
m.add(base, "easy");
m.add(base + DAY, "good");
const firstDue = base + 31 * DAY;
assert.equal(m.read(base + DAY).masteryLevel, 2);
assert.equal(m.read(base + DAY).masteryDueAt, firstDue);
assert.equal(m.eligible(firstDue - 1), false);
assert.equal(m.eligible(firstDue), true);
assert.equal(m.eligible(base + 2 * DAY, true), true);
m.add(base + 10 * DAY, "good");
assert.equal(m.read(base + 10 * DAY).masteryDueAt, firstDue, "Early success does not move the date");
m.add(firstDue, "good");
assert.equal(m.read(firstDue).masteryLevel, 3);
const secondDue = firstDue + 90 * DAY;
assert.equal(m.read(firstDue).masteryDueAt, secondDue);
m.add(firstDue + 1, "easy");
assert.equal(m.read(firstDue + 1).masteryLevel, 3, "Same-day repetition cannot advance");
m.add(secondDue, "easy");
assert.equal(m.read(secondDue).masteryLevel, 4);
const thirdDue = secondDue + 180 * DAY;
m.add(thirdDue, "good");
assert.equal(m.read(thirdDue).masteryLevel, 5);
assert.equal(m.read(thirdDue).masteryDueAt, thirdDue + 365 * DAY);
m.add(thirdDue + 365 * DAY, "good");
assert.equal(m.read(thirdDue + 365 * DAY).masteryLevel, 5, "Mastery caps at level five");
const miss = thirdDue + 730 * DAY;
m.add(miss, "again");
assert.equal(m.read(miss).masteryLevel, 3);
assert.equal(m.read(miss).bars, 4, "A lapse within mastery does not remove a learning bar");
m.add(miss + 1, "again");
assert.equal(m.read(miss + 1).masteryLevel, 3, "Same-day retry does not stack penalties");
m.add(miss + 90 * DAY, "hard");
assert.equal(m.read(miss + 90 * DAY).masteryLevel, 2);
m.add(miss + 120 * DAY, "hard");
assert.equal(m.read(miss + 120 * DAY).masteryLevel, 1);
assert.equal(m.read(miss + 120 * DAY).masteryDueAt, miss + 127 * DAY);
m.add(miss + 127 * DAY, "hard");
assert.equal(m.read(miss + 127 * DAY).mastered, false);
assert.equal(m.read(miss + 127 * DAY).bars, 4, "Partial at level one returns to Known");
m.add(miss + 127 * DAY + 1, "good");
assert.equal(m.read(miss + 127 * DAY + 1).mastered, false, "Same-day retry cannot remaster");
m.add(miss + 128 * DAY, "good");
assert.equal(m.read(miss + 128 * DAY).masteryLevel, 2);

const p = fixture("paired-maintenance", pair);
p.add(base, "easy", pair[0]);
p.add(base + DAY, "good", pair[1]);
p.add(base + 2 * DAY, "good", pair[0]);
p.add(base + 3 * DAY, "good", pair[1]);
const pairedDue = base + 33 * DAY;
assert.equal(p.read(base + 3 * DAY).masteryDueAt, pairedDue);
p.add(base + 5 * DAY, "good", pair[0]);
assert.deepEqual(p.read(base + 5 * DAY).pendingDirections, [], "Early practice cannot seed maintenance evidence");
p.add(pairedDue, "good", pair[0]);
assert.equal(p.read(pairedDue).masteryLevel, 2);
assert.deepEqual(p.read(pairedDue).pendingDirections, [pair[0]]);
assert.equal(p.eligible(pairedDue), false, "First direction locks the card for the day");
assert.equal(p.eligible(pairedDue + DAY), true);
p.add(pairedDue + DAY, "good", pair[1]);
assert.equal(p.read(pairedDue + DAY).masteryLevel, 3);
assert.equal(p.read(pairedDue + DAY).masteryDueAt, pairedDue + 91 * DAY);
assert.deepEqual(p.read(pairedDue + DAY).pendingDirections, []);
p.add(pairedDue + 91 * DAY, "again", pair[0]);
assert.equal(p.read(pairedDue + 91 * DAY).masteryLevel, 1);
assert.equal(p.read(pairedDue + 91 * DAY).mastered, true);
assert.equal(p.read(pairedDue + 91 * DAY).bars, 4);

const old = fixture("old-mastered");
old.add(MASTERY_MAINTENANCE_SINCE - 10 * DAY, "easy");
old.add(MASTERY_MAINTENANCE_SINCE - 9 * DAY, "good");
const oldProgress = old.read(MASTERY_MAINTENANCE_SINCE);
assert.equal(oldProgress.masteryLevel, 2);
assert.ok(oldProgress.masteryDueAt > MASTERY_MAINTENANCE_SINCE && oldProgress.masteryDueAt <= MASTERY_MAINTENANCE_SINCE + 30 * DAY);
assert.equal(old.read(MASTERY_MAINTENANCE_SINCE + DAY).masteryDueAt, oldProgress.masteryDueAt, "Migration schedule is stable");

// The compact review header must not duplicate its bar graph or display pending-pair noise.
const statusUI = readFileSync("src/components/ReviewCardStatus.tsx", "utf8");
assert.doesNotMatch(statusUI, /Pair pending|review-card-status-count|No bar change/, "Only the graph conveys the four-bar count; pending states stay in the tooltip");
assert.match(statusUI, /progress\.pendingDirections\?\.length/, "The pending reverse direction remains discoverable");
assert.match(statusUI, /trend !== "level"/, "Show a change marker only when progress actually changes");
assert.match(statusUI, /delta > 0 \? <span>\+\$\{delta\}<\/span>/, "Show +1 only for real positive bar changes");
assert.match(statusUI, /gainedFrom >= 0 && bar >= gainedFrom/, "Animate only newly earned progress bars");
const reviewCSS = readFileSync("src/components/review-card.css", "utf8");
assert.match(reviewCSS, /@keyframes review-card-gain/, "The gain has its own visible motion");
assert.match(reviewCSS, /@keyframes review-card-bar-earned/, "The newly earned bar is animated");
const reviewPage = readFileSync("src/components/CosmosWindow.tsx", "utf8");
assert.match(reviewPage, /after\.bars > before\.bars[\s\S]*?1050 : 600/, "Persist the positive delta long enough to see its animation");
console.log("Review bar rules: legacy progression, direction pairs and discreet status UI passed.");
