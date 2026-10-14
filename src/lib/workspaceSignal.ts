/**
 * Cross-WebView invalidation, not content replication. No note text or access
 * tokens ever go into localStorage. The receiver loads from the existing
 * account-scoped database and offline cache using its own normal safeguards.
 */
export function workspaceChangeKey(userId: string): string {
  return `heuresis.knowledge.changed.v1:${userId}`;
}

export function signalWorkspaceChange(userId: string) {
  try {
    localStorage.setItem(workspaceChangeKey(userId), `${Date.now()}:${crypto.randomUUID()}`);
  } catch { /* Optional: another view will still refresh on focus. */ }
}

export function subscribeWorkspaceChanges(userId: string, onChange: () => void) {
  const key = workspaceChangeKey(userId);
  const handler = (event: StorageEvent) => {
    if (event.key === key && event.newValue !== event.oldValue && event.newValue) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
