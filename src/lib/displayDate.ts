const exactDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** Retain relative study labels; use a consistent absolute date in their tooltip. */
export function formatExactDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : exactDate.format(date);
}
