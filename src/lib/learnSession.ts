import { listCards, type CardWithStats, type Collection, type PackWithType } from "./heuresis";
import type { LanguageKey } from "./languages";
import { packLanguage } from "./learnExercises";
import { stateForCycle, type CardLearnState } from "./learnRounds";
import { inLearning, legacyReady, readAcquisition } from "./learningStage";
import { cardHasCompletedSort } from "./sort";

/** A topic as Learn uses it: its cards in Learn, and all its cards as a source of distractors. */
export type LearnTopic = {
  pack: PackWithType;
  language: LanguageKey | null;
  /** Every learning-retention card of the topic (never shown as questions unless in Learn). */
  cards: CardWithStats[];
};

/**
 * Where one card stands inside Learn.
 *   started  an unfinished round is waiting (resume it)
 *   fresh    no round yet in this cycle
 *   retry    the last round did not reach the Review criteria
 *   ready    Ready for Review: waiting to be moved
 */
export type LearnStatus = "started" | "fresh" | "retry" | "ready";

/** The one definition of "this card is in Learn" (sorted, not a reference, phase = learning). */
export function isLearnCard(card: CardWithStats): boolean {
  return card.retention === "learning" && cardHasCompletedSort(card) && inLearning(card);
}

export function learnStatus(card: CardWithStats, state: CardLearnState | undefined | null): LearnStatus {
  const acquisition = readAcquisition(card.data);
  const current = stateForCycle(state ?? undefined, acquisition.cycle);
  if (current?.active) return "started";
  if (current?.last) return current.last.ready ? "ready" : "retry";
  return legacyReady(acquisition) ? "ready" : "fresh";
}

/** Unfinished rounds first, then cards not yet started, then those needing another round. */
const QUEUE_RANK: Record<LearnStatus, number> = { started: 0, fresh: 1, retry: 2, ready: 3 };

export function learnQueue<T extends { card: CardWithStats; status: LearnStatus }>(entries: T[]): T[] {
  return entries.filter((entry) => entry.status !== "ready")
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => QUEUE_RANK[a.entry.status] - QUEUE_RANK[b.entry.status] || a.index - b.index)
    .map(({ entry }) => entry);
}

export async function loadLearnTopics(packs: PackWithType[], collections: Collection[]): Promise<LearnTopic[]> {
  const titles = new Map(collections.map((collection) => [collection.id, collection.title]));
  const topics = await Promise.all(packs.map(async (pack) => ({
    pack, language: packLanguage(pack, titles.get(pack.collection_id)), cards: await listCards(pack.id),
  })));
  return topics.filter((topic) => topic.cards.some(isLearnCard));
}

/* A Learn session that was open when the page was refreshed is reopened where it was. */
const OPEN_KEY = "heuresis.learn.open.v1";
export type OpenLearnSession = { origin: "library" | "topic"; packIds: string[]; title: string };

export function rememberOpenLearn(session: OpenLearnSession | null) {
  try {
    if (session) sessionStorage.setItem(OPEN_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(OPEN_KEY);
  } catch { /* convenience only */ }
}

export function readOpenLearn(origin: OpenLearnSession["origin"]): OpenLearnSession | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? "null") as OpenLearnSession | null;
    if (!parsed || parsed.origin !== origin || !Array.isArray(parsed.packIds) || !parsed.packIds.length) return null;
    return { origin, packIds: parsed.packIds.filter((id) => typeof id === "string"), title: typeof parsed.title === "string" ? parsed.title : "" };
  } catch { return null; }
}
