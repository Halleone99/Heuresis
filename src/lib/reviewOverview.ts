import { listCards, type CardWithStats, type PackWithType } from "./heuresis";
import { cardBarProgress, reviewEligible, reviewedSuccessfullyToday } from "./cardProgress";
import { assessState, directionEvidence, type GradeEvent } from "./knowledgeState";
import { defaultDirections } from "./recommend";
import { loadGradeEvents } from "./reviewEvidence";
import { cardHasCompletedSort, SORTED_AT_KEY } from "./sort";
import { inReview, legacyExerciseTimes, readAcquisition } from "./learningStage";
import { loadLearnOverview, type LearnOverview } from "./learnRounds";
import { isLearnCard, learnStatus } from "./learnSession";
import { loadStudySetup, type StudyTemplate } from "./study";

/**
 * Counts for NEW · LEARN · REVIEW. The three never overlap:
 *   New     unsorted cards
 *   Learn   sorted cards whose phase is Learning (some of them Ready for Review)
 *   Review  sorted cards whose phase is Review
 * Learning exercises are counted on their own and are never added to reviews.
 */
type Counts = {
  /** Review: cards due now. */
  ready: number;
  /** Learn: every card currently in Learn (including those ready for Review). */
  learnCards: number;
  /** Learn: cards that met the Review criteria and wait to be moved. */
  learnReady: number;
  /** Learning exercises answered today / in the last seven local days. */
  learnExercisesToday: number;
  learnExercisesLast7: number;
  /** Of the exercises of the last seven days that were scored, how many were right first time. */
  learnScoredLast7: number;
  learnCorrectLast7: number;
  reviewedToday: number;
  reverseTomorrow: number;
  newReady: number;
  newToday: number;
  /** Newly introduced cards over the past seven local calendar days (including today). */
  newLast7: number;
  /** Distinct card/day review pairs, so repeated attempts do not inflate activity. */
  reviewsLast7: number;
};
export type TopicReviewSummary = Counts & {
  packId: string;
  /** Cards to include in an explicitly requested full-topic review. */
  readyCardIds: string[];
};
export type ReviewOverview = Counts & {
  topics: Record<string, TopicReviewSummary>;
  /** Do not silently show a complete-looking total if any topic failed to load. */
  incomplete: boolean;
  /** False until the Learning tables exist on the server (see LEARN_MIGRATION). */
  learnAvailable: boolean;
};

const COUNT_KEYS: Array<keyof Counts> = [
  "ready", "learnCards", "learnReady", "learnExercisesToday", "learnExercisesLast7", "learnScoredLast7", "learnCorrectLast7",
  "reviewedToday", "reverseTomorrow", "newReady", "newToday", "newLast7", "reviewsLast7",
];

function eventsByCard(events: GradeEvent[] | null) {
  const groups = new Map<string, GradeEvent[]>();
  for (const event of events ?? []) {
    const current = groups.get(event.cardId) ?? [];
    current.push(event);
    groups.set(event.cardId, current);
  }
  return groups;
}

type TopicData = { pack: PackWithType; cards: CardWithStats[]; templates: StudyTemplate[]; defaultTemplateId: string | null; history: GradeEvent[] | null };

/**
 * The homepage and multi-collection launcher use the very same availability
 * rules as Review: learning cards only, sorted, one successful side per day,
 * with the reverse side held for tomorrow.
 */
export async function loadReviewOverview(packs: PackWithType[], now = Date.now()): Promise<ReviewOverview> {
  const sevenDayStart = new Date(now);
  sevenDayStart.setHours(0, 0, 0, 0);
  sevenDayStart.setDate(sevenDayStart.getDate() - 6);
  const today = new Date(now).toDateString();

  const loaded = await Promise.allSettled(packs.filter((pack) => pack.card_count > 0).map(async (pack): Promise<TopicData> => {
    const [cards, setup, history] = await Promise.all([
      listCards(pack.id), loadStudySetup(pack.id, pack.card_type_id), loadGradeEvents(pack.id),
    ]);
    return { pack, cards, templates: setup.templates, defaultTemplateId: setup.defaultTemplateId, history };
  }));
  const data = loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  let incomplete = loaded.some((result) => result.status === "rejected");

  // One request for every card in Learn and for Learning activity in every topic.
  let learn: LearnOverview = { available: false, cards: new Map(), packs: new Map() };
  try { learn = await loadLearnOverview(data.flatMap((topic) => topic.cards.filter(isLearnCard).map((card) => card.id)), now); }
  catch { incomplete = true; }

  const topics: Record<string, TopicReviewSummary> = {};
  for (const { pack, cards, templates, defaultTemplateId, history } of data) {
    const directions = defaultDirections(templates, defaultTemplateId).map((item) => item.id);
    const pair = directions.length === 2 ? directions : [];
    const groups = eventsByCard(history);
    const activity = learn.packs.get(pack.id);
    const summary: TopicReviewSummary = {
      packId: pack.id, ready: 0, learnCards: 0, learnReady: 0,
      learnExercisesToday: activity?.attemptsToday ?? 0, learnExercisesLast7: activity?.attemptsWeek ?? 0,
      learnScoredLast7: activity?.attemptsWeek ?? 0, learnCorrectLast7: activity?.correctWeek ?? 0,
      reviewedToday: 0, reverseTomorrow: 0, newReady: 0, newToday: 0, newLast7: 0, reviewsLast7: 0, readyCardIds: [],
    };

    for (const card of cards) {
      // Exercises recorded by the earlier Learning remain visible as activity (they carried no right/wrong).
      for (const at of legacyExerciseTimes(readAcquisition(card.data))) {
        if (at > now) continue;
        if (at >= sevenDayStart.getTime()) summary.learnExercisesLast7 += 1;
        if (new Date(at).toDateString() === today) summary.learnExercisesToday += 1;
      }
      if (!cardHasCompletedSort(card)) { summary.newReady += 1; continue; }
      // Count newly classified cards independently from their current study phase.
      const sortedAt = card.data[SORTED_AT_KEY];
      if (typeof sortedAt === "string" && sortedAt && Number.isFinite(Date.parse(sortedAt))) {
        const sortedTime = Date.parse(sortedAt);
        if (new Date(sortedTime).toDateString() === today) summary.newToday += 1;
        if (sortedTime >= sevenDayStart.getTime() && sortedTime <= now) summary.newLast7 += 1;
      }
      const grades = history ? groups.get(card.id) ?? [] : null;
      if (grades) {
        const distinctDays = new Set(grades.filter((grade) => grade.at >= sevenDayStart.getTime() && grade.at <= now)
          .map((grade) => new Date(grade.at).toDateString()));
        summary.reviewsLast7 += distinctDays.size;
        if (reviewedSuccessfullyToday(grades, now)) summary.reviewedToday += 1;
      }
      if (isLearnCard(card)) {
        summary.learnCards += 1;
        if (learnStatus(card, learn.cards.get(card.id)) === "ready") summary.learnReady += 1;
        continue;
      }
      if (!inReview(card) || !directions.length) continue;
      const oldState = assessState(directionEvidence(card, null, grades)).state;
      const progress = cardBarProgress(card, grades, oldState, pair, now);
      if (reviewEligible(progress, grades, card.stats.last_encountered_at, false, now, directions)) summary.readyCardIds.push(card.id);
      if (grades && reviewedSuccessfullyToday(grades, now) && pair.length && progress.pendingDirections?.length === 1) {
        summary.reverseTomorrow += 1;
      }
    }
    summary.ready = summary.readyCardIds.length;
    topics[pack.id] = summary;
  }

  const values = Object.values(topics);
  const totals = Object.fromEntries(COUNT_KEYS.map((key) => [key, values.reduce((sum, topic) => sum + topic[key], 0)])) as Counts;
  return { ...totals, topics, incomplete, learnAvailable: learn.available };
}
