/** Completion dates can be exact, year-only, or unknown without another database column.
 * Exact dates use capital_reading_items.finish_date; year-only dates are a small
 * marker inside its existing notes text, shared with Personal OS. */
const YEAR_MARKER = /<!--reading-finished-year:(\d{4})-->/;
const ALL_YEAR_MARKERS = /<!--reading-finished-year:\d{4}-->\n?/g;

export type FinishedDateSource = { finishDate: string; notes: string };

export function completedOn(book: FinishedDateSource): string {
  return book.finishDate || book.notes.match(YEAR_MARKER)?.[1] || "";
}

export function completedInYear(book: FinishedDateSource, year: number): boolean {
  return completedOn(book).slice(0, 4) === String(year);
}

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function parseFinishedDate(value: string, today = localToday()): {
  exactDate: string | null; yearOnly: string | null;
} {
  const date = value.trim();
  if (!date) return { exactDate: null, yearOnly: null };
  if (!/^\d{4}(?:-\d{2}-\d{2})?$/.test(date)) throw new Error("Use YYYY, YYYY-MM-DD, or leave the date blank.");
  const year = Number(date.slice(0, 4));
  if (year < 1900 || year > Number(today.slice(0, 4))) throw new Error("Choose a completion year from 1900 to the present.");
  if (date.length === 4) return { exactDate: null, yearOnly: date };
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today)
    throw new Error("Enter a valid completion date that is not in the future.");
  return { exactDate: date, yearOnly: null };
}

export function notesWithFinishedYear(notes: string, year: string | null): string {
  const withoutMarker = notes.replace(ALL_YEAR_MARKERS, "");
  return year ? [withoutMarker, `<!--reading-finished-year:${year}-->`].filter(Boolean).join("\n") : withoutMarker;
}

export function sortFinished(a: FinishedDateSource, b: FinishedDateSource): number {
  const dateA = completedOn(a);
  const dateB = completedOn(b);
  if (!dateA) return dateB ? 1 : 0;
  if (!dateB) return -1;
  return dateB.localeCompare(dateA);
}
