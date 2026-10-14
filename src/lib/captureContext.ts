import type { KnowledgeSubject, KnowledgeTopic } from "./knowledgeWorkspace";

type ContextArgs = {
  subjects: KnowledgeSubject[];
  topics: KnowledgeTopic[];
  requestedTopicId?: string | null;
  lessonTopicId?: string | null;
  savedSubjectId?: string | null;
  savedTopicId?: string | null;
  notebookSubjectId?: string | null;
  notebookTopicId?: string | null;
  documentTopicId?: string | null;
};

export type CaptureContext = { subjectId: string | null; topicId: string | null };

/**
 * Choose a destination WITHOUT relying on subject array ordering.
 * A persisted language takes precedence over an unrelated Notebook topic.
 * With several languages and no remembered context, prompt for selection.
 */
export function resolveCaptureContext(args: ContextArgs): CaptureContext {
  const subjects = new Set(args.subjects.map((row) => row.id));
  const topicMap = new Map(args.topics.map((row) => [row.id, row]));
  const validTopic = (id?: string | null) => {
    const topic = id ? topicMap.get(id) : undefined;
    return topic && subjects.has(topic.subject_id) ? topic : null;
  };
  const fromTopic = (id?: string | null): CaptureContext | null => {
    const topic = validTopic(id);
    return topic ? { subjectId: topic.subject_id, topicId: topic.id } : null;
  };
  const inbox = (subjectId: string) => args.topics.find((row) =>
    row.subject_id === subjectId && !row.parent_id && row.name.trim().toLocaleLowerCase() === "inbox");
  const inSubject = (subjectId?: string | null): CaptureContext | null => {
    if (!subjectId || !subjects.has(subjectId)) return null;
    const topic = validTopic(args.savedTopicId);
    return { subjectId, topicId: topic?.subject_id === subjectId ? topic.id : inbox(subjectId)?.id ?? null };
  };

  return fromTopic(args.requestedTopicId)
    ?? fromTopic(args.lessonTopicId)
    ?? inSubject(args.savedSubjectId)
    ?? fromTopic(args.savedTopicId)
    ?? fromTopic(args.notebookTopicId)
    ?? fromTopic(args.documentTopicId)
    ?? inSubject(args.notebookSubjectId)
    ?? (args.subjects.length === 1 ? inSubject(args.subjects[0].id) : null)
    ?? { subjectId: null, topicId: null };
}
