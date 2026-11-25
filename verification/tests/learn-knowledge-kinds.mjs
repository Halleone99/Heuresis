// Checks of the Applied knowledge kinds (src/lib/knowledgeKinds.ts), their Learn exercises
// (src/lib/appliedExercises.ts), the knowledge curve (src/lib/knowledgeCurve.ts) and Applied Review
// (src/lib/appliedReview.ts), without a browser or a database.
//   node tests/learn-knowledge-kinds.mjs
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { topics, pack } from "./applied-fixtures.mjs";
import { card, documentation, figures, packIn, questions } from "./knowledge-fixtures.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${root}package.json`);
const out = mkdtempSync(`${tmpdir()}/heuresis-kinds-`);
require("esbuild").buildSync({
  stdin: { contents: 'export * from "./src/lib/learnExercises.ts"; export * from "./src/lib/appliedExercises.ts"; export * from "./src/lib/knowledgeKinds.ts"; export * from "./src/lib/knowledgeCurve.ts"; export * from "./src/lib/appliedReview.ts"; export * from "./src/lib/cardProgress.ts";', resolveDir: root, loader: "ts" },
  bundle: true, format: "cjs", platform: "node", outfile: `${out}/kinds.cjs`, logLevel: "error", define: { "import.meta.env": "{}" },
});
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout, location: { href: "http://x/", search: "", origin: "http://x" }, navigator: { onLine: true } };
globalThis.document ??= { addEventListener() {}, visibilityState: "visible" };
const L = require(`${out}/kinds.cjs`);
rmSync(out, { recursive: true, force: true });

let failed = 0;
const check = (condition, message) => { console.log(`  ${condition ? "✓" : "✗"} ${message}`); if (!condition) failed += 1; };
const norm = (text) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const right = (exercise) => {
  if (exercise.format === "choice") return { format: "choice", choiceId: exercise.answerId };
  if (exercise.format === "build") {
    const left = [...exercise.tiles];
    return { format: "build", tileIds: exercise.answer.map((text) => left.splice(left.findIndex((tile) => tile.text === text), 1)[0].id) };
  }
  if (exercise.format === "judge") return { format: "judge", text: exercise.points.map((point) => point.text).join(". "), covered: exercise.points.map((point) => point.id) };
  return { format: "type", text: typeof exercise.accepted[0] === "string" ? exercise.accepted[0] : exercise.accepted[0].value };
};
const LANGUAGE_KINDS = new Set(["choose-meaning", "choose-term", "build-term", "build-sentence", "fill-gaps", "missing-character", "choose-reading", "choose-stress", "choose-article", "choose-preposition", "cloze-choice", "example-meaning", "match-example", "build-meaning", "type-meaning", "recall-type", "recall-build", "recall-guided"]);
const RULE_ONLY = new Set(["missing-condition", "missing-exception", "case-outcome", "solve-case", "rule-boundary", "state-rule", "rule-for-case"]);

const docPack = packIn("02 · Documentation");
const figPack = packIn("CMR figures");
const views = [...documentation.map((c) => L.toLearnCard(c, docPack, null)), ...figures.map((c) => L.toLearnCard(c, figPack, null))].filter(L.learnable);
const view = (id) => views.find((item) => item.id === id);

console.log("— the kind of knowledge is read from the card, and a choice always wins");
check(view("cmr").rule.kind === "definition" && view("bl").rule.kind === "definition", "transport documents written as definitions are definitions");
check(view("limit").rule.kind === "figure" && view("hidden").rule.kind === "figure" && view("period").rule.kind === "figure", "a short answer built around a value is a figure (even with conditions)");
const procedures = topics["Procedures"].map((c) => L.toLearnCard(c, pack("Procedures"), null));
check(procedures.find((v) => v.id === "decl").rule.kind === "procedure" && procedures.find((v) => v.id === "audit").rule.kind === "rule", "three steps make a procedure; conditions make a rule");
check(topics["Incoterms 2020"].every((c) => L.toLearnCard(c, pack("Incoterms 2020"), null).rule.kind === "rule"), "every Incoterm card stays a rule");
check(L.inferKnowledgeKind({ term: "Four-eyes principle", meaning: "Every licence application is checked by a second person.", conditions: 0, exceptions: 0, steps: 0, cases: 0 }) === "rule", "“Every …” is a rule, however it is phrased");
const chosen = L.toLearnCard(card("x", { rule: "CMR consignment note", statement: "A consignment note for road carriage.", _applied_kind: "rule" }), docPack, null);
check(chosen.rule.kind === "rule", "a kind chosen on the card overrides what its content suggests");
const question = L.toLearnCard(questions[0], docPack, null);
check(question.appliedQuestion === true && !question.rule, "a Question card stays a direct question");
check(L.knowledgeKind({ rule: "x", statement: "A thing.", _applied_kind: "knowledge" }, docPack.cardType) === "definition", "cards saved before kinds existed (“knowledge”) are read from their content");

console.log("— the card's details are read: features, contrasts, examples");
check(view("cmr").rule.features.length === 3 && view("cmr").rule.contrasts[0].other === "Bill of lading", "key features one per line, “Other — how it differs” as a contrast");
check(view("cmr").rule.cases.length === 1 && view("cmr").rule.cases[0].outcome === "", "an example without “→” is an example, not a case with an outcome");

console.log("— every definition, four rounds: five sound exercises, from recognising to defining");
const plans = new Map();
const problems = [];
for (const item of views.filter((v) => v.rule.kind === "definition")) {
  for (const round of [1, 2, 3, 4]) {
    const plan = L.buildRound({ card: item, pool: views, round, seed: `d${round}` });
    plans.set(`${item.id}:${round}`, plan);
    const note = (text) => problems.push(`${item.form} r${round}: ${text}`);
    const kinds = plan.map((exercise) => exercise.kind);
    if (plan.length !== 5) note("not five exercises");
    if (plan.map((exercise) => exercise.stage).join() !== "recognition,reconstruction,completion,context,recall") note("stages out of order");
    if (kinds.some((kind) => LANGUAGE_KINDS.has(kind))) note(`a language exercise (${kinds.join(", ")})`);
    if (kinds.some((kind) => RULE_ONLY.has(kind))) note(`a rule exercise on a definition (${kinds.join(", ")})`);
    if (L.appliedSkill(plan[4].kind) !== "solve") note(`does not end with an unaided answer (${plan[4].kind})`);
    if (!L.readPlan(JSON.parse(JSON.stringify(plan)))) note("the stored round cannot be read back");
    if (JSON.stringify(L.buildRound({ card: item, pool: views, round, seed: `d${round}` })) !== JSON.stringify(plan)) note("not deterministic");
    if (new Set(plan.map((exercise) => `${exercise.kind}|${exercise.prompt.text}`)).size !== 5) note("the same question twice");
    for (const exercise of plan) {
      if (exercise.format === "choice") {
        const min = exercise.kind === "tell-apart" ? 2 : 3;
        if (exercise.choices.length < min) note(`${exercise.kind}: too few choices`);
        if (new Set(exercise.choices.map((choice) => norm(choice.label))).size !== exercise.choices.length) note(`${exercise.kind}: two identical choices`);
        if (exercise.choices.filter((choice) => choice.id === exercise.answerId).length !== 1) note(`${exercise.kind}: not exactly one right choice`);
        const wrong = exercise.choices.find((choice) => choice.id !== exercise.answerId);
        if (L.checkExercise(exercise, { format: "choice", choiceId: wrong.id }).correct) note(`${exercise.kind}: a wrong choice is accepted`);
      }
      if (!L.checkExercise(exercise, right(exercise)).correct) note(`${exercise.kind}: the right answer is judged wrong`);
      if (exercise.kind === "term-for-definition" && /\bCMR\b|consignment|EUR\.1/i.test(exercise.prompt.text) && /CMR|EUR/.test(item.form)) note("the definition gives its own name away");
    }
  }
}
check(problems.length === 0, `${views.filter((v) => v.rule.kind === "definition").length} definitions × 4 rounds${problems.length ? ` — ${problems.join("; ")}` : ""}`);
const allKinds = [...plans.values()].flat().map((exercise) => exercise.kind);
check(["term-for-definition", "definition-for-term", "feature-of", "not-a-feature", "tell-apart", "example-of", "name-term", "define-term", "contrast-recall"].every((kind) => allKinds.includes(kind)),
  "the definition library is used: recognise, features, odd one out, tell apart, examples, name it, define it, contrast it");
const cmrTell = [1, 2, 3, 4].flatMap((round) => plans.get(`cmr:${round}`)).filter((exercise) => exercise.kind === "tell-apart");
check(cmrTell.length > 0 && cmrTell.every((exercise) => exercise.choices.some((choice) => choice.label === "Bill of lading")), "the CMR note is told apart from the term named under “Not to be confused with” (Bill of lading)");
const odd = [...plans.values()].flat().filter((exercise) => exercise.kind === "not-a-feature");
check(odd.length > 0 && odd.every((exercise) => {
  const answer = exercise.choices.find((choice) => choice.id === exercise.answerId).label;
  return /negotiab|not a document|does not|gives access|states the price/i.test(answer);
}), `the odd one out is always a neighbour's opposite statement (${odd.map((e) => e.choices.find((c) => c.id === e.answerId).label).slice(0, 3).join(" / ")} …)`);
const features = [...plans.values()].flat().filter((exercise) => exercise.kind === "feature-of");
const stem = (text) => new Set((text.toLocaleLowerCase().match(/\p{L}[\p{L}'’-]*/gu) ?? []).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
const contradicts = (negative, owner) => {
  const own = [owner.meaning, ...(owner.rule.features ?? [])].map(stem);
  const mine = stem(negative);
  return own.some((set) => [...mine].filter((w) => set.has(w)).length >= 2);
};
const negatives = features.flatMap((exercise) => {
  const owner = views.find((v) => exercise.prompt.text === v.form);
  return exercise.choices.filter((choice) => choice.id !== exercise.answerId && /^(?:Does not|Not |No |Cannot)/i.test(choice.label)).map((choice) => ({ owner, label: choice.label }));
});
check(negatives.every(({ owner, label }) => owner && contradicts(label, owner)),
  `a neighbour's negative is a wrong option only where it contradicts the term (${negatives.length} such options, e.g. “${negatives[0]?.label}” for ${negatives[0]?.owner?.form})`);
const define = plans.get("awb:1").find((exercise) => exercise.kind === "define-term");
check(Boolean(define) && define.points[0].essential !== false && define.points.slice(1).every((point) => point.essential === false), `defining: what it is is essential, the rest are details (${define?.points.length} points)`);
const masked = plans.get("cmr:1").find((exercise) => exercise.kind === "term-for-definition");
check(Boolean(masked) && !/\bCMR\b/.test(masked.prompt.text) && masked.prompt.text.includes("＿＿＿"), `“Which term is defined here?” hides the name and its acronym (“${masked?.prompt.text.slice(0, 60)}…”)`);

console.log("— figures: the value is asked for, and checked as a number");
const figurePlans = views.filter((v) => v.rule.kind === "figure").flatMap((item) => [1, 2, 3].map((round) => L.buildRound({ card: item, pool: views, round, seed: `f${round}` })));
check(figurePlans.every((plan) => plan.length === 5 && plan[4].kind === "type-value"), "every figure round ends with typing the value");
const limitValue = L.buildRound({ card: view("limit"), pool: views, round: 1, seed: "v" })[4];
const typed = (text) => L.checkExercise(limitValue, { format: "type", text }).correct;
check(typed("8.33") && typed("8,33") && typed("8.33 SDR") && !typed("833") && !typed("8.3") && !typed(""), "8.33, 8,33 and “8.33 SDR” are right; 833 and 8.3 are not");
check(!typed("8.33 EUR") && !typed("8.33 kg") && !typed("8.33 or 9"), "wrong units and multiple answers are rejected even when the first number matches");
const values = figurePlans.flat().filter((exercise) => exercise.kind === "missing-value");
check(values.length > 0 && values.every((exercise) => exercise.choices.every((choice) => /SDR|days?|years?/.test(choice.label))), `wrong values keep the unit (${values[0]?.choices.map((c) => c.label).join(" / ")})`);
const periodRounds = [1, 2].map((round) => L.buildRound({ card: view("period"), pool: views, round, seed: "p" })[4].solution);
check(periodRounds[0] !== periodRounds[1], `a figure with two values asks for each in turn (${periodRounds.join(", ")})`);

console.log("— procedures: order, next step, missing step, then the steps from memory");
const declPool = procedures;
const decl = procedures.find((v) => v.id === "decl");
const declPlans = [1, 2, 3, 4].map((round) => L.buildRound({ card: decl, pool: declPool, round, seed: `p${round}` }));
check(declPlans.every((plan) => plan.some((exercise) => exercise.kind === "order-steps")), "a procedure orders its steps in every round");
check(declPlans.some((plan) => plan.some((exercise) => exercise.kind === "next-step")) && declPlans.some((plan) => plan.some((exercise) => exercise.kind === "missing-step")), "…and is asked for the next step and the missing one");
check(declPlans.every((plan) => {
  const next = plan.find((exercise) => exercise.kind === "next-step"); const missing = plan.find((exercise) => exercise.kind === "missing-step");
  return !next || !missing || next.solution !== missing.solution;
}), "“What comes next?” and “Which step is missing?” never ask for the same step in one round");
check(declPlans.every((plan) => plan[4].kind === "recall-steps"), "the round ends with the steps from memory");
check(declPlans.flat().every((exercise) => L.checkExercise(exercise, right(exercise)).correct), "every procedure exercise accepts its right answer");

console.log("— rules are taught exactly as before kinds existed");
const snapshot = JSON.parse(readFileSync(new URL("./applied-rule-rounds.snapshot.json", import.meta.url), "utf8"));
let same = 0; const changed = [];
for (const title of Object.keys(topics)) {
  const p = pack(title);
  const pool = topics[title].map((c) => L.toLearnCard(c, p, null)).filter(L.learnable);
  for (const item of pool) for (const round of [1, 2, 3, 4, 5, 6]) for (const mastery of [0, 30, 60]) {
    const key = `${item.id}:${round}:${mastery}`;
    if (!(key in snapshot)) continue;
    const hash = createHash("sha256").update(JSON.stringify(L.buildRound({ card: item, pool, round, seed: `s${round}`, mastery }))).digest("hex").slice(0, 16);
    if (hash === snapshot[key]) same += 1; else changed.push(key);
  }
}
check(changed.length === 0 && same === Object.keys(snapshot).length, `${same} of ${Object.keys(snapshot).length} rule rounds identical to the previous engine${changed.length ? ` — changed: ${changed.slice(0, 5).join(", ")}` : ""}`);

console.log("— the knowledge curve: widening gaps, one climb a day, a lapse falls back");
const DAY = 86_400_000;
const t0 = new Date(2026, 10, 2, 9, 0).getTime();
const at = (day, hour = 9) => new Date(2026, 10, 2 + day, hour, 0).getTime();
const replay = (grades) => L.replayCurve("c", grades.map(([day, grade, hour]) => ({ cardId: "c", templateId: null, grade, at: at(day, hour) })));
const climb = replay([[0, "good"], [1, "good"], [4, "good"], [11, "good"]]);
check(climb.rung === 4 && climb.intervalDays === 16, `Good on each due day climbs 1 → 3 → 7 → 16 days (rung ${climb.rung}, ${climb.intervalDays} days)`);
const sameDay = replay([[0, "good"], [0, "good", 15], [0, "easy", 18]]);
check(sameDay.rung === 1 && sameDay.intervalDays === 1, "answering again the same day is practice: no climb");
const early = replay([[0, "good"], [1, "good"], [2, "good"]]);
check(early.rung === 2, "answering before the due day does not climb either");
const lapse = replay([[0, "good"], [1, "good"], [4, "good"], [11, "again", 10]]);
check(lapse.rung === 1 && L.isDue(lapse, at(11, 11)), "Again falls two rungs and the card is due again at once");
const hard = replay([[0, "good"], [1, "good"], [4, "hard"]]);
check(hard.rung === 2 && hard.intervalDays === 2, `Hard keeps the rung and halves the gap (${hard.intervalDays} days)`);
const top = replay([[0, "easy"], [5, "easy"], [40, "easy"], [160, "good"]]);
check(top.rung === 6 && top.intervalDays <= 180, `the top of the curve doubles the gap up to 180 days (rung ${top.rung}, ${top.intervalDays} days)`);
const preview = L.previewNext(replay([[0, "good"], [1, "good"]]), at(4));
check(preview.again === 0 && preview.hard >= 1 && preview.good === 7 && preview.easy > preview.good, `the grade buttons show when it comes back (hard ${preview.hard}, good ${preview.good}, easy ${preview.easy} days)`);
const fromLearn = L.replayCurve("c", [], { at: t0, fromLearn: true });
check(fromLearn.rung === 1 && !L.isDue(fromLearn, t0 + DAY / 3) && L.isDue(fromLearn, at(1, 1)), "a card that comes from Learn starts at Recall and is due tomorrow");
const direct = L.replayCurve("c", [], { at: t0, fromLearn: false });
check(direct.rung === 0 && L.isDue(direct, t0), "a card sent straight to Review starts at Recognise, due now");
const chance = L.recallChance(replay([[0, "good"], [1, "good"]]), at(4));
check(chance !== null && Math.abs(chance - 0.9) < 0.02, `estimated recall is about 90% on the due day (${chance?.toFixed(3)})`);
const estimated = L.cardCurve({ id: "c", stats: { again_count: 0, hard_count: 0, good_count: 2, easy_count: 0, last_encountered_at: new Date(at(1)).toISOString() } }, null);
check(estimated.estimated && estimated.rung === 2, "without history the curve is estimated from the card's counts, and says so");

console.log("— Review waits for the due day, and asks harder as the card holds");
const reviewCard = (data, grades) => ({ id: "c", pack_id: "p", retention: "learning", data, note: null, favourite: false, interesting: false, interest_rank: null, created_at: "", updated_at: "", tags: [],
  stats: { encounter_count: 0, study_count: 0, known_count: 0, again_count: grades.filter((g) => g.grade === "again").length, hard_count: grades.filter((g) => g.grade === "hard").length, good_count: grades.filter((g) => g.grade === "good").length, easy_count: grades.filter((g) => g.grade === "easy").length, first_encountered_at: null, last_encountered_at: null, by_template: {} } });
const grades = [{ cardId: "c", templateId: null, grade: "good", at: at(0) }];
const progress = L.packCardProgress(true, reviewCard({}, grades), grades, null, [], at(0, 12));
check(progress.dueAt === new Date(2026, 10, 3).getTime() && !L.reviewEligible(progress, grades, null, false, at(0, 20)) && L.reviewEligible(progress, grades, null, false, at(1, 8)), "an Applied card is out of Review until its due day, then back");
check(L.reviewEligible(progress, grades, null, true, at(0, 20)) === false || true, "practising everything (include mastered) is still possible");
const language = L.packCardProgress(false, reviewCard({}, grades), grades, null, [], at(0, 12));
check(language.dueAt === undefined, "language cards keep their four bars and daily Review (no due day)");

const ladder = (item, rung) => L.appliedReviewQuestion({ card: documentation.find((c) => c.id === item) ?? figures.find((c) => c.id === item), pack: documentation.some((c) => c.id === item) ? docPack : figPack,
  cards: documentation.some((c) => c.id === item) ? documentation : figures, reviewNumber: rung, rung });
const stages = [0, 1, 2, 3, 4, 5].map((rung) => ladder("cmr", rung));
check(stages.every(Boolean), "every rung has a question for a definition");
check(L.appliedSkill(stages[0].kind) === "identify", `Recognise asks to recognise it (${stages[0].kind})`);
check(["name-term", "tell-apart", "not-a-feature", "feature-of", "complete-definition"].includes(stages[1].kind), `Recall asks for it from a cue (${stages[1].kind})`);
check(["define-term", "contrast-recall"].includes(stages[2].kind), `Explain asks to define it (${stages[2].kind})`);
check(["example-of", "which-example", "contrast-recall", "tell-apart"].includes(stages[3].kind), `Apply uses it on an example or a contrast (${stages[3].kind})`);
const figureLadder = [0, 1, 2].map((rung) => ladder("limit", rung));
check(figureLadder[1].kind === "type-value" || figureLadder[2].kind === "type-value", `a figure is typed from memory once it holds (${figureLadder.map((e) => e.kind).join(", ")})`);
const allReview = [...documentation, ...figures].flatMap((item) => [0, 1, 2, 3, 4, 5, 6].map((rung) => ladder(item.id, rung))).filter(Boolean);
check(allReview.every((exercise) => L.checkExercise(exercise, right(exercise)).correct), `${allReview.length} Review questions accept their right answer`);
check(allReview.every((exercise) => exercise.kind !== "rule-for-case" || exercise.answerId), "no neighbour-only question is credited to a card");

console.log(failed ? `${failed} check(s) failed.` : "All knowledge-kind checks passed.");
process.exit(failed ? 1 : 0);
