/** Acknowledge a late revision only if it contains our own last saved note. */
type Stored = { updated_at: string; title: string; body: string; topic_id: string; kind: string; category: string | null; lesson_date: string | null };
type Saved = { title: string; body: string; topicId: string; category: string; lessonDate: string };
export function adoptOwnSaveRevision(current: Stored | null | undefined, base: string, saved: Saved): string {
  if (!current || !base || current.updated_at === base) return base;
  const same = current.body === saved.body
    && current.title.trim() === saved.title.trim()
    && current.topic_id === saved.topicId
    && (current.kind !== "note" || (current.category ?? "note") === saved.category)
    && (current.kind !== "lesson" || (current.lesson_date ?? "") === saved.lessonDate);
  return same ? current.updated_at : base;
}
