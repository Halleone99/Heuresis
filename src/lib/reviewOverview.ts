import { listCards, type PackWithType } from "./heuresis";
import { cardBarProgress, reviewEligible, reviewedSuccessfullyToday } from "./cardProgress";
import { assessState, directionEvidence, type GradeEvent } from "./knowledgeState";
import { defaultDirections } from "./recommend";
import { loadGradeEvents } from "./reviewEvidence";
import { cardHasCompletedSort, SORTED_AT_KEY } from "./sort";
import { loadStudySetup } from "./study";

export type TopicReviewSummary = {
  packId: string;
  ready: number;
  reviewedToday: number;
  reverseTomorrow: number;
  newReady: number;
  newToday: number;
  /** Cards to include in an explicitly requested full-topic review. */
  readyCardIds: string[];
};
export type ReviewOverview = {
  ready: number;
  reviewedToday: number;
  reverseTomorrow: number;
  newReady: number;
  newToday: number;
  topics: Record<string, TopicReviewSummary>;
  /** Do not silently show a complete-looking total if any topic failed to load. */
  incomplete: boolean;
};

function eventsByCard(events: GradeEvent[] | null) {
  const groups = new Map<string, GradeEvent[]>();
  for (const event of events ?? []) {
    const current = groups.get(event.cardId) ?? [];
    current.push(event);
    groups.set(event.cardId, current);
  }
  return groups;
}

/**
 * The homepage and multi-collection launcher use the very same availability
 * rules as Review: learning cards only, sorted, one successful side per day,
 * with the reverse side held for tomorrow.
 */
export async function loadReviewOverview(packs: PackWithType[], now = Date.now()): Promise<ReviewOverview> {
  const summaries = await Promise.allSettled(packs.filter((pack) => pack.card_count > 0).map(async (pack) => {
    const [cards, setup, history] = await Promise.all([
      listCards(pack.id), loadStudySetup(pack.id, pack.card_type_id), loadGradeEvents(pack.id),
    ]);
    const directions = defaultDirections(setup.templates, setup.defaultTemplateId).map((item) => item.id);
    const pair = directions.length === 2 ? directions : [];
    const groups = eventsByCard(history);
    const readyCardIds: string[] = [];
    let reviewedToday = 0;
    let reverseTomorrow = 0;
    let newReady = 0;
    let newToday = 0;
    const today = new Date(now).toDateString();

    for (const card of cards) {
      if (!cardHasCompletedSort(card)) { newReady += 1; continue; }
      // A card counts towards the daily new-card quota only once it is actually
      // classified and saved. Undo removes _sorted_at and reverses this count.
      const sortedAt = card.data[SORTED_AT_KEY];
      if (typeof sortedAt === "string" && sortedAt && Number.isFinite(Date.parse(sortedAt))
        && new Date(sortedAt).toDateString() === today) newToday += 1;
      if (!directions.length) continue;
      const grades = history ? groups.get(card.id) ?? [] : null;
      const oldState = assessState(directionEvidence(card, null, grades)).state;
      const progress = cardBarProgress(card, grades, oldState, pair, now);
      if (reviewEligible(progress, grades, card.stats.last_encountered_at, false, now, directions)) readyCardIds.push(card.id);
      if (reviewedSuccessfullyToday(grades, now)) {
        reviewedToday += 1;
        if (pair.length && progress.pendingDirections?.length === 1) reverseTomorrow += 1;
      }
    }
    return { packId: pack.id, ready: readyCardIds.length, reviewedToday, reverseTomorrow, newReady, newToday, readyCardIds };
  }));

  const topics: Record<string, TopicReviewSummary> = {};
  let incomplete = false;
  for (const result of summaries) {
    if (result.status === "fulfilled") topics[result.value.packId] = result.value;
    else incomplete = true;
  }
  const values = Object.values(topics);
  return {
    ready: values.reduce((sum, topic) => sum + topic.ready, 0),
    reviewedToday: values.reduce((sum, topic) => sum + topic.reviewedToday, 0),
    reverseTomorrow: values.reduce((sum, topic) => sum + topic.reverseTomorrow, 0),
    newReady: values.reduce((sum, topic) => sum + topic.newReady, 0),
    newToday: values.reduce((sum, topic) => sum + topic.newToday, 0),
    topics,
    incomplete,
  };
}
