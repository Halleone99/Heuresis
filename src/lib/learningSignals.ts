import { fieldByRole, type CardWithStats, type PackWithType } from "./heuresis";
import type { StudyTemplate } from "./study";

export type DirectionKind = "recognition" | "production" | "other";
export type TemplatePerformance = {
  templateId: string;
  attempts: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  score: number | null;
};

export type DirectionTemplates = {
  recognition: StudyTemplate | null;
  production: StudyTemplate | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function templatePerformance(card: CardWithStats, templateId: string | null | undefined): TemplatePerformance | null {
  if (!templateId) return null;
  const row = card.stats.by_template?.[templateId];
  if (!row || typeof row !== "object") return { templateId, attempts: 0, again: 0, hard: 0, good: 0, easy: 0, score: null };
  const again = numberValue(row.again);
  const hard = numberValue(row.hard);
  const good = numberValue(row.good);
  const easy = numberValue(row.easy);
  const attempts = again + hard + good + easy;
  return { templateId, attempts, again, hard, good, easy, score: attempts ? (good + easy) / attempts : null };
}

export function aggregatePerformance(card: CardWithStats) {
  const { again_count, hard_count, good_count, easy_count } = card.stats;
  const attempts = again_count + hard_count + good_count + easy_count;
  return attempts ? (good_count + easy_count) / attempts : null;
}

export function templateDirection(pack: PackWithType, template: StudyTemplate): DirectionKind {
  const term = fieldByRole(pack.cardType, "term")?.key;
  const meaning = fieldByRole(pack.cardType, "meaning")?.key;
  if (!term || !meaning) return "other";
  const front = new Set(template.front);
  const back = new Set([...template.back, ...template.details]);
  if (front.has(term) && back.has(meaning)) return "recognition";
  if (front.has(meaning) && back.has(term)) return "production";
  return "other";
}

export function directionTemplates(pack: PackWithType, templates: StudyTemplate[]): DirectionTemplates {
  let recognition: StudyTemplate | null = null;
  let production: StudyTemplate | null = null;
  for (const template of templates) {
    const kind = templateDirection(pack, template);
    if (kind === "recognition" && !recognition) recognition = template;
    if (kind === "production" && !production) production = template;
  }
  return { recognition, production };
}

export function daysSince(timestamp: string | null | undefined, now = Date.now()) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

export function isKeepMissing(card: CardWithStats) {
  const hits = card.stats.good_count + card.stats.easy_count;
  return card.stats.again_count >= 3 && card.stats.again_count > hits;
}

export function isNotSeenRecently(card: CardWithStats, days = 30) {
  const age = daysSince(card.stats.last_encountered_at);
  return card.stats.encounter_count > 0 && age !== null && age >= days;
}

export function productionPerformance(card: CardWithStats, directions: DirectionTemplates) {
  return templatePerformance(card, directions.production?.id);
}

export function recognitionPerformance(card: CardWithStats, directions: DirectionTemplates) {
  return templatePerformance(card, directions.recognition?.id);
}

export function isWeakProduction(card: CardWithStats, directions: DirectionTemplates) {
  const production = productionPerformance(card, directions);
  if (!production || production.attempts < 2 || production.score === null || production.score >= 0.55) return false;
  const recognition = recognitionPerformance(card, directions);
  return !recognition || recognition.score === null || recognition.score >= production.score + 0.15;
}

export function attentionScore(card: CardWithStats, directions: DirectionTemplates) {
  if (card.stats.encounter_count === 0) return 10_000;
  let score = 0;
  if (isKeepMissing(card)) score += 900;
  if (isWeakProduction(card, directions)) score += 650;
  const age = daysSince(card.stats.last_encountered_at);
  if (age !== null) score += Math.min(365, age);
  const aggregate = aggregatePerformance(card);
  if (aggregate !== null) score += (1 - aggregate) * 200;
  return score;
}

export function formatSeen(timestamp: string | null | undefined) {
  const age = daysSince(timestamp);
  if (age === null) return "never seen";
  if (age === 0) return "seen today";
  if (age === 1) return "seen yesterday";
  return `seen ${age} days ago`;
}
