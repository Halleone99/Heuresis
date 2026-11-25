// Applied Review: one deterministic, card-attributed question per scheduled Review.
// Run from verification/: node tests/applied-review.mjs (requires esbuild in the project).
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { RULE_TYPE, pack, topics } from "./applied-fixtures.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${root}package.json`);
const out = mkdtempSync(`${tmpdir()}/heuresis-applied-review-`);
try {
  require("esbuild").buildSync({
    stdin: { contents: 'export * from "./src/lib/appliedReview.ts"; export * from "./src/lib/learnExercises.ts"; export * from "./src/lib/appliedExercises.ts";', resolveDir: root, loader: "ts" },
    bundle: true, format: "cjs", platform: "node", outfile: `${out}/review.cjs`, logLevel: "error", define: { "import.meta.env": "{}" },
  });
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout, location: { href: "http://x/", search: "", origin: "http://x" }, navigator: { onLine: true } };
  globalThis.document ??= { addEventListener() {}, visibilityState: "visible" };
  const { appliedReviewQuestion, checkExercise, toLearnCard, buildRound } = require(`${out}/review.cjs`);
  let seen = 0;
  for (const [title, cards] of Object.entries(topics)) {
    for (const card of cards) {
      for (let reviewNumber = 0; reviewNumber < 6; reviewNumber += 1) {
        const args = { card, cards, pack: pack(title), reviewNumber };
        const exercise = appliedReviewQuestion(args);
        if (!exercise) throw new Error(`Missing applied question: ${title}/${card.id}/${reviewNumber}`);
        if (JSON.stringify(exercise) !== JSON.stringify(appliedReviewQuestion(args))) throw new Error("Review question not deterministic");
        if (!["choice", "build", "judge", "type"].includes(exercise.format)) throw new Error("Unsupported Review exercise format");
        if (exercise.format === "type" && !checkExercise(exercise, { format: "type", text: typeof exercise.accepted[0] === "string" ? exercise.accepted[0] : exercise.accepted[0].value }).correct) throw new Error("Correct typed answer rejected");
        if (exercise.kind === "rule-for-case" && exercise.answerId !== card.id) throw new Error("Neighbour-only question attributed to target card");
        if (exercise.format === "choice" && !checkExercise(exercise, { format: "choice", choiceId: exercise.answerId }).correct) throw new Error("Correct choice rejected");
        if (exercise.format === "judge" && !checkExercise(exercise, { format: "judge", text: exercise.solution, covered: exercise.points.map(point => point.id) }).correct) throw new Error("Complete self-check rejected");
        if (exercise.format === "build") {
          const remaining = [...exercise.tiles];
          const ids = exercise.answer.map(value => remaining.splice(remaining.findIndex(tile => tile.text === value), 1)[0].id);
          if (!checkExercise(exercise, { format: "build", tileIds: ids }).correct) throw new Error("Correct steps rejected");
        }
        seen += 1;
      }
      const target = toLearnCard(card, pack(title), null);
      const pool = cards.map(other => toLearnCard(other, pack(title), null));
      for (const exercise of buildRound({ card: target, pool, round: 2, seed: `attribution:${card.id}` })) {
        if (exercise.kind === "rule-boundary" && !exercise.prompt.ask.includes(target.form)) throw new Error("Boundary question lacks the target rule");
      }
    }
  }
  const standard = { ...pack("Standard"), cardType: { ...RULE_TYPE, id: "standard", teaching_shape: "standard" } };
  if (appliedReviewQuestion({ pack: standard, card: topics["Incoterms 2020"][0], cards: topics["Incoterms 2020"], reviewNumber: 0 })) throw new Error("Language cards must not receive Applied Review");
  console.log(`✓ ${seen} Applied Review questions checked across six visits, including correct answers, attribution and standard-mode isolation`);
} finally { rmSync(out, { recursive: true, force: true }); }
// All assertions above are synchronous. Like the other Applied logic suites,
// finish explicitly so imported browser auth timers cannot keep Node alive.
process.exit(0);
