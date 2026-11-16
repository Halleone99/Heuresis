/** Local calendar-day wording for the Study Desk's last-opened timestamp. */
export function relativeOpened(value: string | null | undefined, now = new Date()): string | null {
  if (!value) return null;
  const opened = new Date(value);
  if (Number.isNaN(opened.getTime())) return null;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(opened.getFullYear(), opened.getMonth(), opened.getDate());
  const days = Math.max(0, Math.round((day.getTime() - from.getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks + (weeks === 1 ? " week ago" : " weeks ago");
  }
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(opened);
}
