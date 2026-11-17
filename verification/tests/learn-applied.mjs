// Checks of Applied (rule) learning in src/lib/appliedExercises.ts, without a browser or a
// database: rounds are chosen by what each card holds, run from recognising to producing, never
// answer themselves (by context, by a name or by a case seen earlier in the round), build on the
// previous round, and judge the right answer right. Fixtures: tests/applied-fixtures.mjs.
//   node tests/learn-applied.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RULE_TYPE, card, extraCase, pack, topics } from "./applied-fixtures.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${root}package.json`);
const out = mkdtempSync(`${tmpdir()}/heuresis-applied-`);
require("esbuild").buildSync({
  stdin: { contents: 'export * from "./src/lib/learnExercises.ts"; export * from "./src/lib/appliedExercises.ts"; export * from "./src/lib/teachingShape.ts";', resolveDir: root, loader: "ts" },
  bundle: true, format: "cjs", platform: "node", outfile: `${out}/applied.cjs`, logLevel: "error", define: { "import.meta.env": "{}" },
});
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout, location: { href: "http://x/", search: "", origin: "http://x" }, navigator: { onLine: true } };
globalThis.document ??= { addEventListener() {}, visibilityState: "visible" };
const L = require(`${out}/applied.cjs`);
rmSync(out, { recursive: true, force: true });
const { buildRound, checkExercise, readPlan, toLearnCard, packLanguage, learnable, roundHistory, judgeResult, cardTypeShape, splitOutcome, swapParties, appliedCoverage, answerMentions, appliedSkill } = L;

let failed = 0;
const check = (condition, message) => { console.log(`  ${condition ? "✓" : "✗"} ${message}`); if (!condition) failed += 1; };
const viewsOf = (title) => topics[title].map((item) => toLearnCard(item, pack(title), packLanguage(pack(title), title))).filter(learnable);
const allViews = Object.keys(topics).flatMap((title) => viewsOf(title).map((view) => ({ title, view })));
const norm = (text) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const right = (exercise) => {
  if (exercise.format === "choice") return { format: "choice", choiceId: exercise.answerId };
  if (exercise.format === "build") {
    const left = [...exercise.tiles];
    return { format: "build", tileIds: exercise.answer.map((text) => left.splice(left.findIndex((tile) => tile.text === text), 1)[0].id) };
  }
  if (exercise.format === "judge") return { format: "judge", text: exercise.points.map((point) => point.text).join(". "), covered: exercise.points.map((point) => point.id) };
  if (exercise.format === "gaps") return { format: "gaps", letters: exercise.cells.filter((cell) => cell.gap).map((cell) => cell.ch) };
  return { format: "type", text: typeof exercise.accepted[0] === "string" ? exercise.accepted[0] : exercise.accepted[0].value };
};
const LANGUAGE_KINDS = new Set(["choose-meaning", "choose-term", "build-term", "build-sentence", "fill-gaps", "missing-character", "choose-reading", "choose-stress", "choose-article", "choose-preposition", "cloze-choice", "example-meaning", "match-example", "build-meaning", "type-meaning", "recall-type", "recall-build", "recall-guided"]);
const SKILL_RANK = { identify: 0, wording: 1, scope: 2, sequence: 3, apply: 4, solve: 5 };

console.log("— every Applied card, four rounds: five sound exercises, chosen by what the card holds");
const rounds = new Map();
for (const title of Object.keys(topics)) {
  const views = viewsOf(title);
  const problems = [];
  for (const view of views) {
    for (const round of [1, 2, 3, 4]) {
      const plan = buildRound({ card: view, pool: views, round, seed: `seed-${round}` });
      rounds.set(`${view.id}:${round}`, plan);
      const kinds = plan.map((exercise) => exercise.kind);
      const note = (text) => problems.push(`${view.form} r${round}: ${text}`);
      if (plan.length !== 5) note("not five exercises");
      if (plan.map((exercise) => exercise.stage).join() !== "recognition,reconstruction,completion,context,recall") note("stored stages out of order");
      if (kinds.some((kind) => LANGUAGE_KINDS.has(kind))) note(`a language exercise on a rule card (${kinds.join(", ")})`);
      if (appliedSkill(plan[4].kind) !== "solve") note(`does not end with an unaided answer (${plan[4].kind})`);
      const ranks = plan.slice(1, 4).map((exercise) => SKILL_RANK[appliedSkill(exercise.kind)]);
      if (ranks.some((rank, index) => index && rank < ranks[index - 1])) note(`the middle is not ordered from easier to harder (${kinds.join(", ")})`);
      if (!readPlan(JSON.parse(JSON.stringify(plan)))) note("the stored round cannot be read back");
      if (JSON.stringify(buildRound({ card: view, pool: views, round, seed: `seed-${round}` })) !== JSON.stringify(plan)) note("not deterministic");
      const used = plan.flatMap((exercise) => exercise.uses ?? []);
      if (new Set(used).size !== used.length) note("the same case is asked about twice in one round");
      if (new Set(plan.map((exercise) => `${exercise.kind}|${exercise.prompt.text}`)).size !== 5) note("the same question twice in one round");
      if (plan[4].kind === "solve-case") {
        const held = norm(plan[4].prompt.text).slice(-30);
        if (plan.slice(0, 4).some((exercise) => norm(`${exercise.prompt.text} ${exercise.format === "choice" ? exercise.choices.map((choice) => choice.label).join(" ") : ""}`).includes(held)))
          note("the case solved at the end was shown earlier in the round");
        const outcome = plan[4].points.find((point) => point.id === "outcome").text;
        if (norm(`${plan[4].prompt.text} ${plan[4].prompt.sub ?? ""}`).includes(norm(outcome))) note("the final case shows its own outcome");
      }
      for (const exercise of plan) {
        if (exercise.format === "choice") {
          if (exercise.choices.length < 3) note(`${exercise.kind}: too few choices`);
          if (new Set(exercise.choices.map((choice) => norm(choice.label))).size !== exercise.choices.length) note(`${exercise.kind}: two identical choices`);
          if (exercise.choices.filter((choice) => choice.id === exercise.answerId).length !== 1) note(`${exercise.kind}: not exactly one right choice`);
          const wrong = exercise.choices.find((choice) => choice.id !== exercise.answerId);
          if (checkExercise(exercise, { format: "choice", choiceId: wrong.id }).correct) note(`${exercise.kind}: a wrong choice is accepted`);
          if (exercise.kind === "rule-for-case" && exercise.choices.some((choice) => norm(exercise.prompt.text).includes(norm(choice.label)))) note("a case names one of the rules offered");
        }
        if (exercise.format === "build" && exercise.tiles.map((tile) => tile.text).join("|") === exercise.answer.join("|")) note(`${exercise.kind}: the pieces start in the right order`);
        if (!checkExercise(exercise, right(exercise)).correct) note(`${exercise.kind}: the right answer is judged wrong`);
      }
    }
  }
  check(problems.length === 0, `${title}: ${views.length} ${views.length === 1 ? "rule" : "rules"}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
}

const planOf = (id, round = 1) => rounds.get(`${id}:${round}`);
const kindsOf = (id, round = 1) => planOf(id, round).map((exercise) => exercise.kind);
const anyRound = (id, kind) => [1, 2, 3, 4].map((round) => planOf(id, round).find((exercise) => exercise.kind === kind)).find(Boolean);

console.log("— the plan follows the card's structure");
check(kindsOf("decl").includes("order-steps") && kindsOf("claim").includes("order-steps") && kindsOf("ifrs-steps").includes("order-steps"), "procedures (export declaration, expense claim, IFRS five steps) always order their steps");
check(!allViews.some(({ view }) => !view.rule.steps.length && [1, 2, 3, 4].some((round) => kindsOf(view.id, round).includes("order-steps"))), "rules without steps are never asked to order steps");
const casey = allViews.filter(({ view }) => view.rule.cases.some((item) => item.outcome));
check(casey.every(({ view }) => [1, 2, 3, 4].every((round) => kindsOf(view.id, round).some((kind) => kind === "case-outcome" || kind === "solve-case"))), `every rule with a case is applied to a case in every round (${casey.length} rules)`);
const wording = new Set(["build-statement", "complete-statement", "complete-condition", "name-rule"]);
const rich = allViews.filter(({ title, view }) => view.rule.cases.length && viewsOf(title).length >= 3);
check(rich.every(({ view }) => [1, 2, 3, 4].every((round) => !kindsOf(view.id, round).some((kind) => wording.has(kind)))), `no wording exercise for a rule with a case and neighbours (${rich.length} rules, 4 rounds)`);
const lone = kindsOf("lone");
check(lone.length === 5 && lone[4] === "state-rule" && lone.slice(0, 4).every((kind) => wording.has(kind) || kind === "missing-condition"), `a rule alone in its topic, with no case, falls back to wording and stating the rule (${lone.join(", ")})`);

console.log("— questions do not answer themselves");
const identify = [...rounds.values()].flat().filter((exercise) => appliedSkill(exercise.kind) === "identify");
const answeredByOther = identify.filter((exercise) => exercise.kind === "rule-for-case" && exercise.answerId && !rounds.has(`${exercise.answerId}:1`) ? false : true);
const contrast = [...rounds.entries()].filter(([key, plan]) => plan.some((exercise) => exercise.kind === "rule-boundary" && exercise.answerId !== key.split(":")[0]));
check(contrast.length >= 20, `interleaving: ${contrast.length} rounds test the target rule's boundary against a neighbour's case`);
check(contrast.every(([key, plan]) => plan.filter((exercise) => exercise.kind === "rule-boundary")
  .every((exercise) => exercise.prompt.ask.includes(viewsOf(Object.keys(topics).find(title => viewsOf(title).some(view => view.id === key.split(":")[0]))).find(view => view.id === key.split(":")[0]).form))), "interleaved questions explicitly name the rule whose boundary is being assessed");
check(answeredByOther.length > 0, "identification questions exist in every topic with neighbours");
const fca = viewsOf("Incoterms 2020").find((view) => view.id === "fca");
const fcaPlans = [1, 2, 3, 4].map((round) => planOf("fca", round));
check(fcaPlans.flat().filter((exercise) => exercise.kind === "rule-for-case").every((exercise) => !/\bFCA\b/.test(exercise.prompt.text)), "a case that names its own Incoterm (“FCA Hamburg …”) has the name hidden");
check(fcaPlans.every((plan) => plan[4].kind !== "solve-case" || !plan[4].prompt.text.includes("FCA")), "the case to solve does not name the rule either");

console.log("— wrong options are real confusions");
const exwOutcome = anyRound("exw", "case-outcome") ?? anyRound("fca", "case-outcome");
check(Boolean(exwOutcome) && exwOutcome.choices.some((choice) => choice.note === "The parties are the other way round."), `seller and buyer swapped is offered as a wrong outcome (“${exwOutcome?.choices.find((choice) => choice.id === "swap")?.label ?? "—"}”)`);
check(swapParties("The seller loads the goods onto the buyer's truck.") === "The buyer loads the goods onto the seller's truck." && swapParties("Revenue is recognised over time.") === null, "the swap changes both parties, and nothing when no pair is named");
const hotelOutcome = [1, 2, 3, 4].map((round) => planOf("hotel", round).find((exercise) => exercise.kind === "case-outcome")).find((exercise) => exercise?.choices.some((choice) => /^o\d/.test(choice.id)));
check(Boolean(hotelOutcome), "with three cases, the rule's own other case is a wrong option (same rule, different facts)");
const leaks = [...rounds.values()].filter((plan) => plan[4].kind === "solve-case").filter((plan) => {
  const held = norm(plan[4].points.find((point) => point.id === "outcome").text);
  return plan.slice(0, 4).some((exercise) => exercise.format === "choice" && exercise.choices.some((choice) => norm(choice.label) === held));
});
check(leaks.length === 0, `the outcome of the case kept back never appears earlier as an option (${leaks.length} leaks)`);
const oralCondition = anyRound("oral", "missing-condition");
check(Boolean(oralCondition) && oralCondition.choices.some((choice) => /prohibitions|regular series/.test(choice.label)), "a missing condition is offered beside the rule's own exception");
const value = anyRound("hotel", "missing-value") ?? anyRound("oral", "missing-value");
check(Boolean(value) && value.choices.every((choice) => /EUR \d|\d[\d,]* kg|\d+ days/.test(choice.label)), `thresholds keep their unit and format (${value ? value.choices.map((choice) => choice.label).join(" / ") : "none"})`);
const ifrsContrast = [1, 2, 3, 4].map((round) => planOf("ifrs-time", round)).flat().find((exercise) => exercise.kind === "rule-boundary");
check(!ifrsContrast || ifrsContrast.choices.some((choice) => choice.id === "ifrs-time"), "a neighbour's case always offers this card's rule as the tempting wrong answer");

console.log("— the next round builds on the last one");
const hotel = viewsOf("Example travel expense policy").find((view) => view.id === "hotel");
const hotelPool = viewsOf("Example travel expense policy");
const first = buildRound({ card: hotel, pool: hotelPool, round: 1, seed: "h1" });
const scopeAt = first.findIndex((exercise) => appliedSkill(exercise.kind) === "scope");
const failedScope = roundHistory(first, first.map((exercise, index) => ({ position: index + 1, correct: index !== scopeAt, assisted: false })), 40);
const second = buildRound({ card: hotel, pool: hotelPool, round: 2, seed: "h2", history: failedScope });
check(scopeAt >= 0 && second.slice(1, 4).some((exercise) => appliedSkill(exercise.kind) === "scope"), `a missed Scope question comes back in the next round (${second.map((exercise) => exercise.kind).join(", ")})`);
check(first[4].kind === "solve-case" && second[4].kind === "solve-case" && first[4].uses[0] !== second[4].uses[0], "the next round solves a different case from the last one");
const twoCases = viewsOf("Incoterms 2020").find((view) => view.id === "fca");
let previous = null; let repeats = 0;
for (const round of [1, 2, 3, 4]) {
  const plan = buildRound({ card: twoCases, pool: viewsOf("Incoterms 2020"), round, seed: `r${round}`, history: previous });
  if (previous?.solved?.[0] === plan[4].uses?.[0]) repeats += 1;
  previous = roundHistory(plan, plan.map((exercise) => ({ position: exercise.position, correct: true, assisted: false })), 30);
}
check(repeats === 0, "with two cases, the case to solve alternates from round to round");
const named = first.find((exercise) => exercise.kind === "case-outcome");
const later = buildRound({ card: hotel, pool: hotelPool, round: 2, seed: "h2", history: { ...failedScope, score: 40 } }).find((exercise) => exercise.kind === "case-outcome");
const weakLater = buildRound({ card: hotel, pool: hotelPool, round: 2, seed: "h2", history: { ...failedScope, score: 20 } }).find((exercise) => exercise.kind === "case-outcome");
check(Boolean(named?.prompt.sub) && Boolean(later) && !later.prompt.sub && Boolean(weakLater?.prompt.sub), "a first round names the rule in “What follows?”; a later one leaves it out, unless the last round went badly");

console.log("— free answers are judged on the card's own points");
check(JSON.stringify(splitOutcome("The seller bears the loss: risk passes only on delivery at the terminal.")) === JSON.stringify({ outcome: "The seller bears the loss", reason: "Risk passes only on delivery at the terminal." }), "an outcome and its reason are separated (after a colon, a dash or “because”)");
const solves = [...rounds.values()].map((plan) => plan[4]).filter((exercise) => exercise.kind === "solve-case");
const solve = solves.find((exercise) => exercise.points.some((point) => point.id === "reason"));
const solveNoReason = solves.find((exercise) => !exercise.points.some((point) => point.id === "reason"));
check(Boolean(solve) && solve.points.map((point) => `${point.id}:${point.essential !== false}`).join() === "outcome:true,reason:true,rule:false", "solving a case with a stated reason: outcome and reason are essential, naming the rule is a detail");
check(Boolean(solveNoReason) && solveNoReason.points.map((point) => `${point.id}:${point.essential !== false}`).join() === "outcome:true,rule:true", "without a stated reason, the rule that decides it is essential");
const partial = checkExercise(solve, { format: "judge", text: "The seller bears it.", covered: ["outcome"] });
check(!partial.correct && /Partly right/.test(partial.message) && /reason/.test(partial.message), `partly right answers say what is missing (“${partial.message}”)`);
const state = anyRound("oral", "state-rule");
const details = state.points.filter((point) => point.essential === false).length;
check(details === 4 && judgeResult(state, ["statement", "c1", "x1"]).correct && !judgeResult(state, ["statement", "c1"]).correct && !judgeResult(state, ["c1", "c2", "x1", "x2"]).correct,
  "stating a rule: what it requires is essential; of its 4 conditions and exceptions, 2 are enough");
check(!checkExercise(state, { format: "judge", text: "", covered: [] }).correct, "no answer (I don’t know) is wrong, never an error");
check(answerMentions("The seller has to load the goods", "The seller loads the goods onto the buyer's truck.") && !answerMentions("No idea, something about insurance", "The seller loads the goods onto the buyer's truck."),
  "the advisory check notices a ticked point that the answer does not mention");
check(checkExercise(solve, { format: "judge", text: "x".repeat(5000), covered: ["outcome", "reason", "rule"] }).response.length <= 900, "a long answer is stored within the database limit");

console.log("— the card is read as written, and only what is confirmed is used");
const cif = toLearnCard(topics["Incoterms 2020"][3], pack("Incoterms 2020"), null);
check(cif.rule.conditions.join("|") === "Sea or inland waterway transport only" && cif.rule.exceptions.length === 1 && cif.rule.cases.length === 2, "conditions, exceptions and a case added as a note are read");
check(toLearnCard(topics.Procedures[0], pack("Procedures"), null).rule.steps[0] === "Classify the goods (CN code)", "numbered steps lose their numbers");
const generated = card("gen", { rule: "Test rule", statement: "A statement long enough for a test.", case: "Own case.", outcome: "Own outcome.",
  _workspace_blocks: [extraCase("A suggested case.", "A suggested outcome.", { origin: "generated" }), extraCase("A confirmed suggestion.", "Its outcome.", { origin: "generated", verified: true })] });
const genCases = toLearnCard(generated, pack("x"), null).rule.cases.map((item) => item.situation);
check(genCases.join("|") === "Own case.|A confirmed suggestion.", "a generated case is used only once it is confirmed");
check(packLanguage(pack("German export control"), "German") === null, "a topic named “German …” is not treated as a language topic");

console.log("— Applied is a property of the card type, stated explicitly");
const custom = { id: "custom", name: "Vocabulary with source", field_schema: [{ key: "term", label: "Word", role: "term" }, { key: "meaning", label: "English", role: "meaning" }, { key: "source", label: "Source", role: "source" }] };
check(cardTypeShape(custom) === "standard" && cardTypeShape({ ...custom, teaching_shape: null }) === "standard", "a custom type with a “Source” field stays a standard (language) type");
check(cardTypeShape({ ...custom, teaching_shape: "rule" }) === "rule" && cardTypeShape({ id: RULE_TYPE.id }) === "rule", "teaching_shape 'rule' makes a type Applied; the built-in Rule type is known by its id before the migration");
check(cardTypeShape({ ...custom, teaching_shape: "fact" }) === "standard", "an unknown future shape is taught as standard until it is supported");
const sourced = toLearnCard(card("v", { term: "der Zoll", meaning: "customs", source: "Duden" }), pack("German B1", custom), "de");
check(!sourced.rule && sourced.language === "de", "…and its cards keep their language exercises");

console.log("— what a card can do is shown while it is written");
const bare = toLearnCard(card("bare", { rule: "Four-eyes principle", statement: "Every licence application is checked by a second person." }), pack("x"), null);
check(/Add a case/.test(appliedCoverage(bare, 0).hint), `a bare card is told what would help most (“${appliedCoverage(bare, 0).hint}”)`);
check(appliedCoverage(fca, 5).hint === "" && appliedCoverage(fca, 5).skills.includes("solve"), "a card with two cases and neighbours needs nothing more");


console.log("— direct Applied Questions ask for answers, not their own prompts");
const questionCards = [
  card("qa-1", { rule: "When does risk transfer under FOB?", statement: "When goods are loaded on board the vessel.", _applied_kind: "question" }),
  card("qa-2", { rule: "What is an EORI?", statement: "An EU customs identification number for economic operators.", _applied_kind: "question" }),
  card("qa-3", { rule: "Which document accompanies road transport?", statement: "A CMR consignment note.", _applied_kind: "question" }),
  card("qa-4", { rule: "How does a Sea Waybill ease release?", statement: "No original negotiable B/L needs to be surrendered by the named consignee.", _applied_kind: "question" }),
];
const qa = questionCards.map((item) => toLearnCard(item, pack("Q&A"), null));
check(qa.every((item) => item.appliedQuestion && !item.rule), "Question cards retain their Q&A identity; no procedural rule is fabricated");
for (const item of qa) {
  const plan = buildRound({ card: item, pool: qa, round: 1, seed: "qa-test" });
  check(plan.length === 5 && plan.every((exercise) => exercise.prompt.text === item.term) && plan[4].format === "judge",
    `direct Q&A for ${item.id}: five correctly directed exercises ending in written answer`);
  check(readPlan(JSON.parse(JSON.stringify(plan))) !== null && plan.every((exercise) => checkExercise(exercise, right(exercise)).correct),
    `direct Q&A for ${item.id}: persisted exercises accept the answer`);
  check(JSON.stringify(plan) === JSON.stringify(buildRound({ card: item, pool: qa, round: 1, seed: "qa-test" })),
    `direct Q&A for ${item.id}: deterministic round`);
}
check(toLearnCard(card("old", { rule: "Plain principle", statement: "Its explanation." }), pack("x"), null).rule !== undefined,
  "Existing Applied cards without a kind remain Knowledge");
console.log(failed ? `${failed} Applied check(s) failed.` : "All Applied exercise checks passed.");
process.exit(failed ? 1 : 0);
