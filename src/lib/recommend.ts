import { fieldText, type CardWithStats } from "./heuresis";
import { importanceOf, IMPORTANCE_LABEL } from "./importance";
import {
  assessState, daysSinceEvidence, directionEvidence, STATE_LABEL,
  type DirectionEvidence, type GradeEvent, type KnowledgeState,
} from "./knowledgeState";
import type { StudyTemplate } from "./study";

/**
 * Review recommendations: "of everything I could review, what is most useful now?"
 *
 * Each (card, direction) gets a score from three kinds of evidence:
 *   need        — what the results in that direction show (its knowledge state);
 *   time        — how long since that direction was last seen. Time is evidence that
 *                 a check is worthwhile, never a deadline; it saturates at about 45 days;
 *   importance  — a gentle multiplier (at most about 12 %), so weak but peripheral
 *                 knowledge still comes back.
 * A session is then picked greedily with soft mixing: every new card already chosen
 * makes the next new card a little less attractive, and every familiar card the next
 * familiar one, so new and familiar cards mix without a fixed ratio (weak familiar
 * cards still come first). The opposite direction of a card already chosen is
 * discounted and never placed right after it.
 * Every recommendation carries plain-language reasons.
 */

export type RecommendDirection = {
  templateId: string;
  label: string;
  front: string[];
  /** The pack's default direction also carries results recorded without a direction. */
  legacy?: boolean;
};

export type Recommendation = {
  cardId: string;
  templateId: string;
  score: number;
  state: KnowledgeState;
  isNew: boolean;
  reasons: string[];
};

export const NEED: Record<KnowledgeState, number> = {
  "needs-work": 1,
  "not-tried": 0.7,
  developing: 0.65,
  holding: 0.3,
  strong: 0.12,
};
const NEED_WEIGHT = 0.62;
const TIME_WEIGHT = 0.38;
const TIME_SATURATION_DAYS = 45;
const NEW_DAMPING = 0.14;
const FAMILIAR_DAMPING = 0.08;
const SAME_CARD_FACTOR = 0.55;
const MIN_GAP = 3;

export function timeFactor(days: number | null) {
  if (days === null) return 0.5;
  return Math.min(1, Math.log1p(days) / Math.log1p(TIME_SATURATION_DAYS));
}

export function importanceFactor(rank: number | null | undefined) {
  const level = importanceOf(rank ?? null);
  return level === "core" ? 1 : level === "useful" ? 0.95 : level === "peripheral" ? 0.88 : 0.92;
}

export function candidateKey(cardId: string, templateId: string) {
  return `${cardId}:${templateId}`;
}

type Candidate = {
  card: CardWithStats;
  direction: RecommendDirection;
  evidence: DirectionEvidence;
  state: KnowledgeState;
  agedFrom: KnowledgeState | null;
  score: number;
  reasons: string[];
};

function plural(count: number, word: string) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function describe(candidate: Omit<Candidate, "reasons" | "score">, days: number | null): string[] {
  const { evidence, state, direction, agedFrom } = candidate;
  const dir = `in ${direction.label}`;
  const reasons: string[] = [];
  if (state === "not-tried") reasons.push(`Not tried ${dir} yet.`);
  else if (state === "needs-work") {
    const last = evidence.recent[evidence.recent.length - 1];
    reasons.push(last === "again"
      ? `Missed last time ${dir}.`
      : `Needs work ${dir}: ${evidence.successes} of ${plural(evidence.attempts, "attempt")} recalled.`);
  } else if (state === "developing") reasons.push(`Developing ${dir}: ${evidence.successes} of ${plural(evidence.attempts, "attempt")} recalled so far.`);
  else if (state === "holding") reasons.push(`Holding ${dir}; a check keeps the evidence current.`);
  else reasons.push(`Strong ${dir}; included for a fresh check.`);

  if (agedFrom) reasons.push(`It was ${STATE_LABEL[agedFrom].toLowerCase()}, but the last confirmation is over four months old.`);
  if (days !== null && days >= 7) reasons.push(evidence.lastAtApproximate ? `Last seen ${days} days ago.` : `Last reviewed in this direction ${days} days ago.`);
  else if (days !== null && days <= 1 && state !== "needs-work") reasons.push(days === 0 ? "Seen today." : "Seen yesterday.");

  const level = importanceOf(candidate.card.interest_rank);
  if (level === "core") reasons.push(`Marked ${IMPORTANCE_LABEL.core}.`);
  else if (level === "peripheral" && (state === "needs-work" || state === "developing")) reasons.push("Peripheral, but included because the results are weak.");
  return reasons;
}

function hasFront(card: CardWithStats, direction: RecommendDirection) {
  return !direction.front.length || direction.front.some((key) => fieldText(card.data, key).trim());
}

export function scoreCandidates(input: {
  cards: CardWithStats[];
  directions: RecommendDirection[];
  events: GradeEvent[] | null;
  now?: number;
}): Candidate[] {
  const now = input.now ?? Date.now();
  const list: Candidate[] = [];
  for (const card of input.cards) {
    for (const direction of input.directions) {
      if (!hasFront(card, direction)) continue;
      const evidence = directionEvidence(card, direction.templateId, input.events, { includeUnattributed: direction.legacy });
      const { state, agedFrom } = assessState(evidence, now);
      const days = daysSinceEvidence(evidence, now);
      const time = state === "not-tried" ? 0.5 : timeFactor(days);
      const score = (NEED_WEIGHT * NEED[state] + TIME_WEIGHT * time) * importanceFactor(card.interest_rank);
      const base = { card, direction, evidence, state, agedFrom };
      list.push({ ...base, score, reasons: describe(base, state === "not-tried" ? null : days) });
    }
  }
  return list;
}

/**
 * Keep the two directions of one card apart: at least MIN_GAP positions when possible,
 * and never directly after each other unless nothing else is left. Order otherwise
 * stays as given (most useful first). `recent` holds the card ids answered just before
 * this list (the end of the previous round), oldest first.
 */
export function spaceSameCards<T extends { cardId: string }>(items: T[], recent: string[] = []): T[] {
  const pending = [...items];
  const result: T[] = [];
  while (pending.length) {
    const near = [...recent, ...result.map((item) => item.cardId)].slice(-(MIN_GAP - 1));
    const last = near[near.length - 1];
    let pick = pending.findIndex((item) => !near.includes(item.cardId));
    if (pick < 0) pick = pending.findIndex((item) => item.cardId !== last);
    if (pick < 0) pick = 0;
    result.push(...pending.splice(pick, 1));
  }
  return result;
}

/**
 * Choose up to `size` cards for a session. `exclude` holds candidateKey()s already
 * reviewed in this session (for "10 more").
 */
export function recommendSession(input: {
  cards: CardWithStats[];
  directions: RecommendDirection[];
  events: GradeEvent[] | null;
  size: number;
  exclude?: Set<string>;
  /** Card ids answered just before this list (kept apart from its first items). */
  recent?: string[];
  now?: number;
}): Recommendation[] {
  const exclude = input.exclude ?? new Set<string>();
  const pool = scoreCandidates(input).filter((candidate) => !exclude.has(candidateKey(candidate.card.id, candidate.direction.templateId)));
  const chosen: Candidate[] = [];
  const chosenCards = new Set<string>();
  const size = Math.max(0, Math.floor(input.size));
  let newPicked = 0;
  let familiarPicked = 0;
  while (chosen.length < size && pool.length) {
    let bestIndex = -1;
    let bestValue = -1;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      let value = candidate.score;
      if (candidate.state === "not-tried") value /= 1 + NEW_DAMPING * newPicked;
      else value /= 1 + FAMILIAR_DAMPING * familiarPicked;
      if (chosenCards.has(candidate.card.id)) value *= SAME_CARD_FACTOR;
      // Stable tie-break: weaker evidence first, then the card's own order.
      if (value > bestValue + 1e-9) { bestValue = value; bestIndex = index; }
    }
    const [picked] = pool.splice(bestIndex, 1);
    if (picked.state === "not-tried") newPicked += 1; else familiarPicked += 1;
    chosen.push(picked);
    chosenCards.add(picked.card.id);
  }
  return spaceSameCards(chosen.map((candidate) => ({
    cardId: candidate.card.id,
    templateId: candidate.direction.templateId,
    score: Math.round(candidate.score * 1000) / 1000,
    state: candidate.state,
    isNew: candidate.state === "not-tried",
    reasons: candidate.reasons,
  })), input.recent ?? []);
}

/** The direction that older, direction-less results belong to (the pack's default). */
export function legacyTemplateId(templates: StudyTemplate[], defaultTemplateId: string | null): string | null {
  return (templates.find((template) => template.id === defaultTemplateId) ?? templates[0] ?? null)?.id ?? null;
}

/** Directions for a recommended session: the reversible pair containing the default, else the default alone. */
export function defaultDirections(templates: StudyTemplate[], defaultTemplateId: string | null): StudyTemplate[] {
  const preferred = templates.find((template) => template.id === defaultTemplateId) ?? templates[0] ?? null;
  if (!preferred) return [];
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
  const reverse = templates.find((template) => template.id !== preferred.id && same(template.front, preferred.back) && same(template.back, preferred.front));
  return reverse ? [preferred, reverse] : [preferred];
}

export type DirectionPair = { key: string; ids: [string, string]; label: string };

/** Reversible pairs of directions (a → b with b → a), as offered in Adjust. */
export function directionPairs(templates: StudyTemplate[]): DirectionPair[] {
  const same = (left: string[], right: string[]) => left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
  const used = new Set<string>();
  const pairs: DirectionPair[] = [];
  for (const template of templates) {
    if (used.has(template.id)) continue;
    const reverse = templates.find((candidate) => candidate.id !== template.id && !used.has(candidate.id)
      && same(template.front, candidate.back) && same(template.back, candidate.front));
    if (!reverse) continue;
    used.add(template.id);
    used.add(reverse.id);
    const label = template.name.includes("→") ? template.name.replace(/\s*→\s*/, " ↔ ") : `${template.name} ↔ reverse`;
    pairs.push({ key: [template.id, reverse.id].sort().join(":"), ids: [template.id, reverse.id], label });
  }
  return pairs;
}
