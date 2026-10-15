// Unit checks for the Review recommendation engine, knowledge states, importance
// levels, result labels and typed-answer suggestions (real TypeScript sources).
import assert from "node:assert/strict";
import { loadTs } from "./lib/load-ts.mjs";

const stubs = { "./supabase": { supabase: null } };
const states = loadTs("src/lib/knowledgeState.ts", stubs);
const engine = loadTs("src/lib/recommend.ts", stubs);
const check = loadTs("src/lib/answerCheck.ts", stubs);
const importance = loadTs("src/lib/importance.ts", stubs);
const results = loadTs("src/lib/reviewResults.ts", stubs);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15, 12);
const REC = { templateId: "rec", label: "Chinese → English", front: ["term"] };
const PRO = { templateId: "pro", label: "English → Chinese", front: ["meaning"] };

function card(id, { interest = null, byTemplate = {}, lastSeenDays = null } = {}) {
  const totals = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const row of Object.values(byTemplate)) for (const key of Object.keys(totals)) totals[key] += row[key] ?? 0;
  return {
    id, pack_id: "p", retention: "learning", note: null, favourite: false, interesting: false, interest_rank: interest,
    created_at: "", updated_at: "", tags: [], data: { term: `词${id}`, meaning: `meaning ${id}` },
    stats: { encounter_count: 1, study_count: 1, known_count: 0, again_count: totals.again, hard_count: totals.hard, good_count: totals.good, easy_count: totals.easy,
      first_encountered_at: null, last_encountered_at: lastSeenDays == null ? null : new Date(NOW - lastSeenDays * DAY).toISOString(), by_template: byTemplate },
  };
}
const ev = (cardId, templateId, grade, daysAgo) => ({ cardId, templateId, grade, at: NOW - daysAgo * DAY });

// --- Result labels and importance -------------------------------------------------
assert.deepEqual(results.RESULT_ORDER.map((grade) => results.RESULT_LABEL[grade]), ["Missed", "Partial", "Recalled", "Secure"]);
assert.equal(results.isSuccess("easy"), true, "Secure is a successful result");
assert.equal(results.resultCountsText({ again_count: 1, hard_count: 0, good_count: 2, easy_count: 1 }), "1 missed · 2 recalled · 1 secure");
assert.deepEqual([1, 2, 3, 4, 5, null].map(importance.importanceOf), ["peripheral", "peripheral", "useful", "core", "core", null], "existing 1–5 values map to three levels");
assert.deepEqual(importance.IMPORTANCE_RANK, { core: 5, useful: 3, peripheral: 1 });

// --- Knowledge states are evidence-based ------------------------------------------
const assess = (c, tid, events) => states.assessState(states.directionEvidence(c, tid, events), NOW).state;
assert.equal(assess(card("a"), "rec", []), "not-tried");
const missedLast = card("b", { byTemplate: { rec: { good: 3, again: 1 } } });
assert.equal(assess(missedLast, "rec", [ev("b", "rec", "good", 9), ev("b", "rec", "good", 6), ev("b", "rec", "good", 3), ev("b", "rec", "again", 1)]), "needs-work", "a miss last time means needs work");
const sameDay = card("c", { byTemplate: { rec: { good: 6 } } });
assert.equal(assess(sameDay, "rec", [0, 0, 0, 0, 0, 0].map((d) => ev("c", "rec", "good", d))), "developing", "six successes on one day are repetition, not lasting knowledge");
const spread = card("d", { byTemplate: { rec: { good: 4, easy: 1 } } });
assert.equal(assess(spread, "rec", [20, 12, 6, 3, 1].map((d, i) => ev("d", "rec", i === 4 ? "easy" : "good", d))), "strong", "five successes over separate days are strong");
assert.equal(assess(spread, "pro", [20, 12, 6, 3, 1].map((d) => ev("d", "rec", "good", d))), "not-tried", "states are direction-specific");
const holding = card("e", { byTemplate: { rec: { good: 3, hard: 1 } } });
assert.equal(assess(holding, "rec", [ev("e", "rec", "hard", 10), ev("e", "rec", "good", 7), ev("e", "rec", "good", 4), ev("e", "rec", "good", 2)]), "holding");
const old = card("f", { byTemplate: { rec: { good: 5 } } });
const oldAssessment = states.assessState(states.directionEvidence(old, "rec", [400, 300, 250, 200, 180].map((d) => ev("f", "rec", "good", d))), NOW);
assert.deepEqual(oldAssessment, { state: "holding", agedFrom: "strong" }, "old evidence lowers Strong one step and says why");
const noHistory = card("g", { byTemplate: { rec: { good: 5 } }, lastSeenDays: 3 });
assert.equal(assess(noHistory, "rec", null), "holding", "without event history, counts alone never reach Strong");

// Partial history (offline, or older than the loaded window) never makes a success look like a step down.
const counted = card("h", { byTemplate: { rec: { good: 10 } }, lastSeenDays: 30 });
assert.equal(assess(counted, "rec", null), "holding", "ten recalls without history: Holding");
assert.equal(assess(counted, "rec", [ev("h", "rec", "good", 0)]), "holding", "one more recall with only today's event known stays Holding");
assert.equal(assess(counted, "rec", [ev("h", "rec", "again", 0)]), "needs-work", "a miss today is still noticed");

// Results recorded without a direction (older sessions) belong to the default direction only.
const legacyCard = card("l", { byTemplate: {} });
Object.assign(legacyCard.stats, { good_count: 4, again_count: 1 });
const legacyEvents = [12, 9, 6, 3].map((d) => ev("l", null, "good", d)).concat([ev("l", null, "again", 15)]).sort((a, b) => a.at - b.at);
assert.deepEqual(states.unattributedCounts(legacyCard), { again: 1, hard: 0, good: 4, easy: 0 });
const legacyState = (tid, include) => states.assessState(states.directionEvidence(legacyCard, tid, legacyEvents, { includeUnattributed: include }), NOW).state;
assert.equal(legacyState("rec", false), "not-tried", "without the option, direction-less history is not attributed");
assert.equal(legacyState("rec", true), "holding", "the default direction keeps direction-less history (4 of 5 recalled, on 4 separate days)");
const partlyAttributed = card("m", { byTemplate: { rec: { good: 1 } } });
Object.assign(partlyAttributed.stats, { good_count: 3 });
assert.deepEqual(states.unattributedCounts(partlyAttributed), { again: 0, hard: 0, good: 2, easy: 0 }, "only the remainder after per-direction counts is unattributed");

// --- Recommendations ----------------------------------------------------------------
const weakPeripheral = card("w", { interest: 1, byTemplate: { rec: { again: 2, good: 1 } } });
const strongCore = card("s", { interest: 5, byTemplate: { rec: { good: 6 } } });
const fresh = card("n", { interest: 5 });
const events = [
  ev("w", "rec", "good", 5), ev("w", "rec", "again", 3), ev("w", "rec", "again", 2),
  ...[30, 20, 10, 6, 4, 2].map((d) => ev("s", "rec", "good", d)),
];
const one = engine.recommendSession({ cards: [strongCore, weakPeripheral, fresh], directions: [REC], events, size: 3, now: NOW });
assert.equal(one[0].cardId, "w", "weak but peripheral knowledge comes before strong core knowledge: importance does not dominate");
assert.ok(one.find((item) => item.cardId === "w").reasons.some((reason) => /Peripheral, but included/.test(reason)), "the reason says why a peripheral card is included");
assert.ok(one.every((item) => item.reasons.length > 0), "every recommendation is explained");

const many = Array.from({ length: 12 }, (_, i) => card(`new${i}`));
const familiar = Array.from({ length: 6 }, (_, i) => card(`old${i}`, { byTemplate: { rec: { good: 2, hard: 1 } } }));
const famEvents = familiar.flatMap((c) => [ev(c.id, "rec", "good", 15), ev(c.id, "rec", "hard", 12), ev(c.id, "rec", "good", 10)]);
const mixed = engine.recommendSession({ cards: [...many, ...familiar], directions: [REC], events: famEvents, size: 10, now: NOW });
const newCount = mixed.filter((item) => item.isNew).length;
assert.ok(newCount > 0 && newCount < 10, `new and familiar cards are mixed (${newCount} new of 10)`);

// New cards are not shut out by a large familiar backlog, and weak cards still lead.
const backlog = Array.from({ length: 40 }, (_, i) => card(`dev${i}`, { byTemplate: { rec: { good: 2, again: 1 } } }));
const backlogEvents = backlog.flatMap((c) => [ev(c.id, "rec", "good", 30), ev(c.id, "rec", "again", 20), ev(c.id, "rec", "good", 10)]);
const untried = Array.from({ length: 40 }, (_, i) => card(`fresh${i}`));
const mixedBacklog = engine.recommendSession({ cards: [...backlog, ...untried], directions: [REC], events: backlogEvents, size: 20, now: NOW });
const backlogNew = mixedBacklog.filter((item) => item.isNew).length;
assert.ok(backlogNew >= 3 && backlogNew <= 12, `a familiar backlog seen 10 days ago still leaves room for new cards (${backlogNew} new of 20)`);
const weak = Array.from({ length: 40 }, (_, i) => card(`weak${i}`, { byTemplate: { rec: { again: 2 } } }));
const weakEvents = weak.flatMap((c) => [ev(c.id, "rec", "again", 4), ev(c.id, "rec", "again", 2)]);
const weakFirst = engine.recommendSession({ cards: [...weak, ...untried], directions: [REC], events: weakEvents, size: 20, now: NOW });
const weakNew = weakFirst.filter((item) => item.isNew).length;
assert.ok(weakNew >= 1 && weakNew < 10 && !weakFirst[0].isNew, `weak cards lead, with a few new cards mixed in (${weakNew} new of 20)`);

// The two directions of one card are never adjacent when another order is possible.
const two = engine.spaceSameCards([{ cardId: "B" }, { cardId: "A" }, { cardId: "A" }, { cardId: "B" }]);
for (let i = 1; i < two.length; i += 1) assert.notEqual(two[i].cardId, two[i - 1].cardId, "B A A B is reordered to avoid A A");
assert.equal(engine.spaceSameCards([{ cardId: "A" }, { cardId: "B" }], ["A"])[0].cardId, "B", "the first card of a new round is not the card just answered");

const both = engine.recommendSession({ cards: [card("x"), card("y"), card("z"), card("v")], directions: [REC, PRO], events: [], size: 8, now: NOW });
for (let i = 1; i < both.length; i += 1) assert.notEqual(both[i].cardId, both[i - 1].cardId, "opposite directions of one card are never adjacent");

const done = new Set(mixed.map((item) => engine.candidateKey(item.cardId, item.templateId)));
const more = engine.recommendSession({ cards: [...many, ...familiar], directions: [REC], events: famEvents, size: 10, exclude: done, now: NOW });
assert.ok(more.every((item) => !done.has(engine.candidateKey(item.cardId, item.templateId))), "10 more never repeats this session's cards");

const pair = engine.defaultDirections([
  { id: "rec", card_type_id: "t", name: "Chinese → English", front: ["term", "reading"], back: ["meaning"], details: [], sort_order: 0 },
  { id: "pro", card_type_id: "t", name: "English → Chinese", front: ["meaning"], back: ["term", "reading"], details: [], sort_order: 1 },
  { id: "x", card_type_id: "t", name: "Example", front: ["example"], back: ["example_translation"], details: [], sort_order: 2 },
], "pro");
assert.deepEqual(pair.map((t) => t.id), ["pro", "rec"], "recommended sessions use the default direction and its reverse");

// --- Typed answers: suggestions only, language-aware ---------------------------------
const s = (typed, expected) => check.suggestResult(typed, expected)?.grade;
assert.equal(check.numberedPinyinToMarks("ni3 hao3"), "nǐ hǎo");
assert.equal(check.numberedPinyinToMarks("lv4"), "lǜ");
assert.equal(check.numberedPinyinToMarks("B1 Lektion 7"), "B1 Lektion 7", "German text with digits is untouched");
assert.equal(s("以后", ["以后"]), "good");
assert.equal(s("yi3hou4", ["yǐhòu"]), "good", "numbered pinyin is accepted");
assert.equal(s("yihou", ["yǐhòu"]), "hard", "right syllables without tones is Partial");
assert.equal(s("yǐ hòu", ["yǐhòu"]), "good", "spacing in pinyin does not matter");
assert.equal(s("while", ["when; while; at the time of"]), "good", "any accepted alternative is Recalled");
assert.equal(s("look forward to", ["to look forward to"]), "good");
assert.equal(s("sich freuen uber", ["sich freuen über"]), "hard", "a missing umlaut is Partial");
assert.equal(s("в москве", ["в Москве́"]), "good", "Russian stress marks are not spelling");
assert.equal(s("ещё", ["еще"]), "good", "ё and е are equivalent");
assert.equal(s("Wochenend", ["Wochenende"]), "hard", "one letter off is Partial");
assert.equal(s("以前", ["以后"]), "again", "a different two-character word is Missed");
assert.equal(s("", ["以后"]), undefined, "an empty answer gets no suggestion");
assert.ok(!["easy"].includes(s("以后", ["以后"])), "Secure is never suggested");
// Fragments of a term or sentence are never accepted as the whole answer.
const exact = (value) => [{ value, kind: "exact" }];
assert.equal(s("Ja", exact("Ja, ich weiß.")), "again", "the first word of a German sentence is not the answer");
assert.notEqual(s("Я думаю", exact("Я думаю, что он прав")), "good", "half a Russian sentence is not the answer");
assert.equal(s("你好", exact("你好，我叫李明")), "again", "half a Chinese sentence is not the answer");
assert.equal(s("e", exact("der Hund, -e")), "again", "a plural ending is not the answer");
assert.equal(s("der Hund", exact("der Hund, -e")), "good", "German noun notation: the noun with its article is the answer");
assert.equal(s("Hund", exact("der Hund, -e")), "hard", "a missing German article is Partial");
assert.equal(s("Mädchen", exact("das Mädchen")), "hard");
assert.notEqual(s("der Wand", exact("an der Wand")), "good", "German “an” is not an English article");
assert.notEqual(s("wait a moment", exact("I'm coming, wait a moment")), "good", "a sentence translation is not split on commas");
assert.equal(s("hound", ["1. dog 2. hound"]), "good", "numbered senses are alternatives");
assert.equal(s("at once", ["immediately, at once"]), "good", "a gloss list is split on commas");
assert.equal(check.suggestResult("Ich komme morgen nicht", exact("Ich komme leider erst übermorgen wieder nach Hause."))?.grade, undefined, "a free translation of a long sentence gets no verdict");
assert.match(check.suggestResult("cafe", ["café"]).reason, /accents/, "a missing accent is explained as an accent, not a tone");
assert.deepEqual(["马上", "你好，我叫李明", "der Hund, -e", "Ja, ich weiß.", "to look forward to"].map(check.isWordSized), [true, false, true, false, false]);

console.log("Review engine, knowledge states, importance levels and typed-answer suggestions: checks passed.");
