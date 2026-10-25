/** A small, non-intrusive account-menu notice when native Windows backups stop. */
export function backupAgeNotice(latestDay: string | null, now: Date = new Date()): string | null {
  if (!latestDay) return "No completed PC backup yet. Check PC backup.";
  const match = latestDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "PC backup date unavailable. Check PC backup.";
  const last = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return today - last > 2 * 24 * 60 * 60 * 1000
    ? `Last completed PC backup: ${latestDay}. Check PC backup.`
    : null;
}
