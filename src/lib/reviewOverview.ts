import { listCards, type PackWithType } from "./heuresis";
import { cardBarProgress, reviewEligible, reviewedSuccessfullyToday } from "./cardProgress";
import { assessState, directionEvidence, type GradeEvent } from "./knowledgeState";
import { defaultDirections } from "./recommend";
import { loadGradeEvents } from "./reviewEvidence";
import { cardHasCompletedSort, SORTED_AT_KEY } from "./sort";
import { acquisitionReady, inLearning, inReview, readAcquisition } from "./learningStage";
import { loadStudySetup } from "./study";

export type TopicReviewSummary = {
  packId: string;
  ready: number;
  learningReady: number;
  learningPrepared: number;
  learningExercisesToday: number;
  learningExercisesLast7: number;
  reviewedToday: number;
  reverseTomorrow: number;
  newReady: number;
  newToday: number;
  /** Newly introduced cards over the past seven local calendar days (including today). */
  newLast7: number;
  /** Distinct card/day review pairs, so repeated attempts do not inflate activity. */
  reviewsLast7: number;
  /** Cards to include in an explicitly requested full-topic review. */
  readyCardIds: string[];
};
export type ReviewOverview = {
  ready: number;
  learningReady: number;
  learningPrepared: number;
  learningExercisesToday: number;
  learningExercisesLast7: number;
  reviewedToday: number;
  reverseTomorrow: number;
  newReady: number;
  newToday: number;
  newLast7: number;
  reviewsLast7: number;
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
  const sevenDayStart = new Date(now);
  sevenDayStart.setHours(0, 0, 0, 0);
  sevenDayStart.setDate(sevenDayStart.getDate() - 6);
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
    let learningReady = 0;
    let learningPrepared = 0;
    let learningExercisesToday = 0;
    let learningExercisesLast7 = 0;
    let newToday = 0;
    let newLast7 = 0;
    let reviewsLast7 = 0;
    const today = new Date(now).toDateString();

    for (const card of cards) {
      // Historical activity remains visible after a Learning → Review transition.
      const acquisition = readAcquisition(card.data);
      for (const event of acquisition.history) {
        if (event.kind !== "exercise") continue;
        const at = Date.parse(event.at);
        if (!Number.isFinite(at) || at > now) continue;
        if (at >= sevenDayStart.getTime()) learningExercisesLast7 += 1;
        if (new Date(at).toDateString() === today) learningExercisesToday += 1;
      }
      if (!cardHasCompletedSort(card)) { newReady += 1; continue; }
      // Count newly classified cards independently from their current study phase.
      const sortedAt = card.data[SORTED_AT_KEY];
      if (typeof sortedAt === "string" && sortedAt && Number.isFinite(Date.parse(sortedAt))) {
        const sortedTime = Date.parse(sortedAt);
        if (new Date(sortedTime).toDateString() === today) newToday += 1;
        if (sortedTime >= sevenDayStart.getTime() && sortedTime <= now) newLast7 += 1;
      }
      const grades = history ? groups.get(card.id) ?? [] : null;
      if (grades) {
        const distinctDays = new Set(grades.filter((grade) => grade.at >= sevenDayStart.getTime() && grade.at <= now)
          .map((grade) => new Date(grade.at).toDateString()));
        reviewsLast7 += distinctDays.size;
        if (reviewedSuccessfullyToday(grades, now)) reviewedToday += 1;
      }
      if (inLearning(card)) {
        learningReady += 1;
        if (acquisitionReady(acquisition)) learningPrepared += 1;
        continue;
      }
      if (!inReview(card) || !directions.length) continue;
      const oldState = assessState(directionEvidence(card, null, grades)).state;
      const progress = cardBarProgress(card, grades, oldState, pair, now);
      if (reviewEligible(progress, grades, card.stats.last_encountered_at, false, now, directions)) readyCardIds.push(card.id);
      if (grades && reviewedSuccessfullyToday(grades, now) && pair.length && progress.pendingDirections?.length === 1) {
        reverseTomorrow += 1;
      }
    }
    return { packId: pack.id, ready: readyCardIds.length, learningReady, learningPrepared, learningExercisesToday, learningExercisesLast7, reviewedToday, reverseTomorrow, newReady, newToday, newLast7, reviewsLast7, readyCardIds };
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
    learningReady: values.reduce((sum, topic) => sum + topic.learningReady, 0),
    learningPrepared: values.reduce((sum, topic) => sum + topic.learningPrepared, 0),
    learningExercisesToday: values.reduce((sum, topic) => sum + topic.learningExercisesToday, 0),
    learningExercisesLast7: values.reduce((sum, topic) => sum + topic.learningExercisesLast7, 0),
    reviewedToday: values.reduce((sum, topic) => sum + topic.reviewedToday, 0),
    reverseTomorrow: values.reduce((sum, topic) => sum + topic.reverseTomorrow, 0),
    newReady: values.reduce((sum, topic) => sum + topic.newReady, 0),
    newToday: values.reduce((sum, topic) => sum + topic.newToday, 0),
    newLast7: values.reduce((sum, topic) => sum + topic.newLast7, 0),
    reviewsLast7: values.reduce((sum, topic) => sum + topic.reviewsLast7, 0),
    topics,
    incomplete,
  };
}
