import type { CardWithStats, PackWithType } from "./heuresis";
import { buildRound, toLearnCard, type Exercise } from "./learnExercises";

/**
 * One practical question for a due Applied card. This is not another Learning round:
 * it uses Learn's verified, deterministic exercise builders, but leaves the existing
 * Review session, directions, grades, spacing and offline event queue untouched.
 *
 * An exercise concerning another rule alone must NEVER count as mastery of this card.
 */
export function appliedReviewQuestion(input: {
  card: CardWithStats;
  pack: PackWithType;
  cards: CardWithStats[];
  /** Completed reviews of this card; changes the question on subsequent visits. */
  reviewNumber: number;
}): Exercise | null {
  const { card, pack, cards } = input;
  try {
    const target = toLearnCard(card, pack, null);
    if (!target.rule || !target.form || !target.meaning) return null;
    const pool = cards.map((entry) => toLearnCard(entry, pack, null));
    const n = Math.max(0, Math.floor(input.reviewNumber));
    const plan = buildRound({ card: target, pool, round: n + 1, seed: `applied-review:${card.id}:${n}` });
    // Never grade a neighbour's identification case as if it were a case of this card.
    const safe = plan.filter((exercise) => {
      if (exercise.format !== "choice" && exercise.format !== "build" && exercise.format !== "judge") return false;
      if (exercise.kind === "rule-for-case") return exercise.format === "choice" && exercise.answerId === card.id;
      return new Set([
        "which-case", "case-outcome", "missing-condition", "missing-exception", "missing-value",
        "order-steps", "solve-case", "recall-steps", "state-rule", "statement-for-rule", "rule-for-statement",
      ]).has(exercise.kind);
    });
    // One in three visits practises independent production; other visits ask a shorter
    // applied question. A sparse card still gets its own unaided recall, not a filler gap.
    const order = n % 3 === 2
      ? ["solve-case", "recall-steps", "state-rule", "case-outcome", "which-case", "order-steps"]
      : n % 3 === 1
        ? ["order-steps", "missing-exception", "missing-condition", "missing-value", "case-outcome", "which-case", "solve-case", "state-rule"]
        : ["case-outcome", "which-case", "missing-condition", "missing-value", "order-steps", "solve-case", "state-rule"];
    return order.map((kind) => safe.find((exercise) => exercise.kind === kind)).find((exercise): exercise is Exercise => Boolean(exercise))
      ?? safe.find((exercise) => exercise.format === "judge") ?? safe[0] ?? null;
  } catch {
    // If the card is too sparse or malformed, conventional Review still works.
    return null;
  }
}
