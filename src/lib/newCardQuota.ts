// Local study preference; review history and progress remain in Supabase.
export const NEW_CARD_QUOTA_EVENT = "heuresis:new-card-quota-changed";
const NEW_CARD_QUOTA_KEY = "heuresis.newCards.dailyQuota.v1";

export function readNewCardQuota(): number {
  try {
    const value = Number(localStorage.getItem(NEW_CARD_QUOTA_KEY));
    if (Number.isSafeInteger(value) && value >= 1 && value <= 50) return value;
  } catch { /* Preferences remain usable when local storage is disabled. */ }
  return 10;
}

export function saveNewCardQuota(value: number): number {
  const next = Math.min(50, Math.max(1, Math.round(value)));
  try { localStorage.setItem(NEW_CARD_QUOTA_KEY, String(next)); } catch { /* Device preference only. */ }
  window.dispatchEvent(new Event(NEW_CARD_QUOTA_EVENT));
  return next;
}
