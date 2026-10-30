/** One-time notes shown when the designer opens a newly converted or imported article. */
const notices = new Map<string, string[]>();
export function setDesignerNotice(articleId: string, lines: string[]) {
  notices.set(articleId, lines);
}
/** Read without removing (safe in React's double-invoked initialisers); clear when dismissed. */
export function peekDesignerNotice(articleId: string) {
  return notices.get(articleId) ?? null;
}
export function clearDesignerNotice(articleId: string) {
  notices.delete(articleId);
}
