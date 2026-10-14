import type { KnowledgeEntry, PracticeEvent } from "./knowledgeWorkspace";

export type MistakeMilestoneKind = "logged" | "first_correct" | "three_days";
export const MISTAKE_MILESTONES: Array<{ id: MistakeMilestoneKind; name: string }> = [
  { id: "logged", name: "Logged" },
  { id: "first_correct", name: "First recalled" },
  { id: "three_days", name: "Three-day milestone" },
];
type Week = { start: Date; key: string; value: number; segments?: Record<string, number> };
export type MistakeJourney = { weeks: Week[]; achievedThreeDays: number; firstCorrectCount: number };

function weekStart(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}
function parsedDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
const localDay = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map((item, index) => index ? String(item).padStart(2, "0") : String(item)).join("-");

/**
 * Historical milestones from real recall events, not inferred status edits:
 * a mistake is logged, recalled correctly for the first time, and recalled
 * correctly on three different local dates since its latest incorrect recall.
 * Several correct attempts on a single date count only once.
 *
 * The history chart records that a milestone *was achieved* on a date;
 * subsequent failures do not erase that historical event.
 */
export function mistakeJourney(
  weeks: Week[],
  entries: KnowledgeEntry[],
  practice: PracticeEvent[],
): MistakeJourney {
  const result = weeks.map((week) => ({ ...week, value: 0, segments: {} as Record<string, number> }));
  const byWeek = new Map(result.map((week) => [week.key, week]));
  const relevant = new Set(entries.filter((row) => row.kind === "mistake").map((row) => row.id));

  function add(date: Date, kind: MistakeMilestoneKind) {
    const slot = byWeek.get(weekStart(date).toISOString());
    if (!slot) return;
    slot.value++;
    slot.segments[kind] = (slot.segments[kind] ?? 0) + 1;
  }
  for (const entry of entries) {
    if (entry.kind !== "mistake") continue;
    const logged = parsedDate(entry.created_at);
    if (logged) add(logged, "logged");
  }

  const byRecord = new Map<string, PracticeEvent[]>();
  for (const event of practice) {
    if (!relevant.has(event.record_id)) continue;
    const date = parsedDate(event.created_at);
    if (!date) continue;
    const bucket = byRecord.get(event.record_id) ?? [];
    bucket.push(event);
    byRecord.set(event.record_id, bucket);
  }

  let achievedThreeDays = 0;
  let firstCorrectCount = 0;
  for (const events of byRecord.values()) {
    events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    let firstCorrect = false;
    let countedDay: string | null = null;
    let streak = 0;
    let reached = false;
    for (const event of events) {
      const date = parsedDate(event.created_at);
      if (!date) continue;
      if (event.outcome === "incorrect") {
        streak = 0;
        countedDay = null;
        continue;
      }
      if (event.outcome !== "correct") continue;
      if (!firstCorrect) {
        firstCorrect = true;
        firstCorrectCount++;
        add(date, "first_correct");
      }
      const day = localDay(date);
      if (day !== countedDay) {
        countedDay = day;
        streak++;
        if (streak >= 3 && !reached) {
          reached = true;
          achievedThreeDays++;
          add(date, "three_days");
        }
      }
    }
  }
  return { weeks: result, achievedThreeDays, firstCorrectCount };
}
