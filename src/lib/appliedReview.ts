import type { CardWithStats, PackWithType } from "./heuresis";
import { buildRound, toLearnCard, type Exercise } from "./learnExercises";
import { stageOf, type CurveStage } from "./knowledgeCurve";

/**
 * One practical question for a due Applied card. This is not another Learning round:
 * it uses Learn's verified, deterministic exercise builders, but leaves the existing
 * Review session, directions, grades and offline event queue untouched.
 *
 * Which question depends on where the card is on the knowledge curve (knowledgeCurve.ts):
 * recognise it while it is new, recall it from a cue once it has held for a day, explain it in
 * your own words after three, use it on a case after a week, and a varied mix after that. Each
 * successful review therefore asks a little more than the last: retrieval gets harder as memory
 * gets stronger, which is what makes spaced review efficient.
 *
 * An exercise concerning another rule alone must NEVER count as mastery of this card.
 */

/** What each stage asks, most fitting first, by kind of card. Unknown kinds fall through to the next. */
const LADDER: Record<CurveStage, string[]> = {
  recognise: [
    "term-for-definition", "definition-for-term", "rule-for-case", "rule-for-statement", "statement-for-rule",
    "first-step", "missing-value", "feature-of", "which-case",
  ],
  recall: [
    "type-value", "name-term", "tell-apart", "not-a-feature", "missing-exception", "missing-condition", "missing-value",
    "next-step", "missing-step", "order-steps", "feature-of", "complete-definition",
  ],
  explain: ["define-term", "state-rule", "recall-steps", "contrast-recall", "type-value"],
  apply: ["solve-case", "case-outcome", "example-of", "which-example", "which-case", "contrast-recall", "recall-steps", "tell-apart"],
  maintain: [],
};
/** Long-term reviews rotate between the harder stages, so nothing is only ever asked one way. */
const MAINTAIN_ORDER: CurveStage[] = ["apply", "explain", "recall"];
/** Fallback when a stage has nothing for this card: the nearest easier stage first, then harder. */
const NEAR: Record<Exclude<CurveStage, "maintain">, Exclude<CurveStage, "maintain">[]> = {
  recognise: ["recognise", "recall", "explain", "apply"],
  recall: ["recall", "recognise", "explain", "apply"],
  explain: ["explain", "recall", "apply", "recognise"],
  apply: ["apply", "explain", "recall", "recognise"],
};

const SAFE = new Set([
  ...LADDER.recognise, ...LADDER.recall, ...LADDER.explain, ...LADDER.apply,
]);

export function appliedReviewQuestion(input: {
  card: CardWithStats;
  pack: PackWithType;
  cards: CardWithStats[];
  /** Completed reviews of this card; changes the question on subsequent visits. */
  reviewNumber: number;
  /** The card's rung on the knowledge curve; without it, the number of reviews stands in. */
  rung?: number;
  /** Cards of the same collection's other Applied topics, as further alternatives. */
  neighbours?: Array<{ card: CardWithStats; pack: PackWithType }>;
}): Exercise | null {
  const { card, pack, cards } = input;
  try {
    const target = toLearnCard(card, pack, null);
    if (!target.rule || !target.form || !target.meaning) return null;
    const pool = [
      ...cards.map((entry) => toLearnCard(entry, pack, null)),
      ...(input.neighbours ?? []).filter((entry) => entry.card.id !== card.id).map((entry) => toLearnCard(entry.card, entry.pack, null)),
    ];
    const n = Math.max(0, Math.floor(input.reviewNumber));
    const rung = input.rung ?? Math.min(n, 3);
    // Two rounds' worth of candidates (an easier and a harder one), so every stage has a choice.
    const plans = [
      ...buildRound({ card: target, pool, round: n + 1, seed: `applied-review:${card.id}:${n}` }),
      ...buildRound({ card: target, pool, round: n + 2, seed: `applied-review:${card.id}:${n}:b`, mastery: 60 }),
    ];
    // Never grade a neighbour's identification case as if it were a case of this card.
    const safe = plans.filter((exercise) => {
      if (exercise.format === "gaps") return false;
      if (exercise.kind === "rule-for-case") return exercise.format === "choice" && exercise.answerId === card.id;
      return SAFE.has(exercise.kind);
    });
    if (!safe.length) return null;
    const stage = stageOf(rung);
    const wanted: Exclude<CurveStage, "maintain"> = stage === "maintain" ? MAINTAIN_ORDER[n % MAINTAIN_ORDER.length] as Exclude<CurveStage, "maintain"> : stage;
    for (const step of NEAR[wanted]) {
      const kinds = LADDER[step].filter((kind) => safe.some((exercise) => exercise.kind === kind));
      if (!kinds.length) continue;
      // Alternate between the two best questions of the stage, so a card is not asked the same way twice running.
      const kind = kinds[n % Math.min(2, kinds.length)];
      return safe.find((exercise) => exercise.kind === kind)!;
    }
    return safe.find((exercise) => exercise.format === "judge") ?? safe[0];
  } catch {
    // If the card is too sparse or malformed, conventional Review still works.
    return null;
  }
}

/** The stage a question was chosen for, as Review shows it ("Recall · 3 days"). */
export function appliedReviewStage(rung: number): CurveStage {
  return stageOf(rung);
}
