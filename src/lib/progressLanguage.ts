export type WeekSlot = { start: Date; key: string; value: number };
export type LanguageEvent = { at: string | null | undefined; subjectId: string | null | undefined };
export type LanguageSeries = { id: string; name: string };
export type StackedWeek = WeekSlot & { segments: Record<string, number> };

const UNASSIGNED = "__unassigned__";

function weekStart(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return start;
}

/** Group each recorded action by its language and Monday, without losing
 * orphaned historical records whose original topic no longer exists. */
export function languageStack(
  weeks: WeekSlot[],
  events: LanguageEvent[],
  subjects: Array<{ id: string; name: string }>,
): { weeks: StackedWeek[]; series: LanguageSeries[] } {
  const slots = weeks.map((week) => ({ ...week, value: 0, segments: {} as Record<string, number> }));
  const indices = new Map(slots.map((week, index) => [week.key, index]));
  const names = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const totals = new Map<string, number>();
  for (const event of events) {
    if (!event.at) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(event.at)
      ? new Date(`${event.at}T12:00:00`) : new Date(event.at);
    if (!Number.isFinite(date.getTime())) continue;
    const index = indices.get(weekStart(date).toISOString());
    if (index === undefined) continue;
    const id = event.subjectId && names.has(event.subjectId) ? event.subjectId : UNASSIGNED;
    const week = slots[index];
    week.value += 1;
    week.segments[id] = (week.segments[id] ?? 0) + 1;
    totals.set(id, (totals.get(id) ?? 0) + 1);
  }
  const series = [...totals.keys()].sort((left, right) => {
    if (left === UNASSIGNED) return 1;
    if (right === UNASSIGNED) return -1;
    return (names.get(left) ?? left).localeCompare(names.get(right) ?? right);
  }).map((id) => ({ id, name: names.get(id) ?? "Unassigned" }));
  return { weeks: slots, series };
}
