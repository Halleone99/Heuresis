import type { CardWithStats } from "./heuresis";
import type { GradeEvent, KnowledgeState } from "./knowledgeState";
import { reviewGradeCount } from "./learningSignals";

/**
 * Four visual progress bars, with a separate Mastered confirmation.
 * Older complete graded histories are replayed using the agreed daily cap.
 * If history is incomplete, keep a conservative approximation from the old state
 * instead of claiming that missing review dates are known.
 */
export type CardBarProgress = {
  bars: number;
  mastered: boolean;
  estimated: boolean;
};

function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function approximateLegacy(card: CardWithStats, oldState: KnowledgeState | null): CardBarProgress {
  const attempts = reviewGradeCount(card);
  if (!attempts) return { bars: 0, mastered: false, estimated: false };
  const successes = Math.max(0, card.stats.good_count + card.stats.easy_count);
  if (oldState === "strong") return { bars: 4, mastered: true, estimated: true };
  if (oldState === "holding") return { bars: 4, mastered: false, estimated: true };
  if (!successes) return { bars: 0, mastered: false, estimated: true };
  return { bars: Math.min(3, Math.max(1, successes)), mastered: false, estimated: true };
}

export function cardBarProgress(
  card: CardWithStats,
  history: GradeEvent[] | null,
  oldState: KnowledgeState | null,
): CardBarProgress {
  const attempts = reviewGradeCount(card);
  if (!attempts) return { bars: 0, mastered: false, estimated: false };
  if (!history || history.length !== attempts) return approximateLegacy(card, oldState);

  let bars = 0;
  let mastered = false;
  let currentDay = "";
  let dailyPeak = 0;
  let advancedToday = false;
  for (const event of [...history].sort((a, b) => a.at - b.at)) {
    const day = dayOf(event.at);
    if (day !== currentDay) {
      currentDay = day;
      dailyPeak = bars;
      advancedToday = false;
    }

    if (event.grade === "again") {
      bars = Math.max(0, bars - 1);
      mastered = false;
    } else if (event.grade === "good" || event.grade === "easy") {
      if (mastered) continue;
      if (bars < dailyPeak && event.grade !== "easy") {
        // A lost bar may be recovered on the same day.
        bars += 1;
      } else if (!advancedToday) {
        if (bars === 4) mastered = true;
        else bars = event.grade === "easy" ? 4 : Math.min(4, bars + 1);
        advancedToday = true;
      } else if (bars < dailyPeak) {
        bars += 1;
      }
      dailyPeak = Math.max(dailyPeak, bars);
    }
  }
  return { bars, mastered, estimated: false };
}
