import { ArrowLeft, ArrowRight, Inbox, ListChecks, NotebookPen } from "lucide-react";
import { entryPreview, entryTitle, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { useWorkspace } from "./WorkspaceContext";

/**
 * One review space for all raw ideas. It reads the existing subject Inboxes
 * rather than maintaining a second capture database.
 */
export function CaptureReviewPage({ onBack, onOpenNote }: {
  onBack: () => void;
  onOpenNote: (entry: KnowledgeEntry) => void;
}) {
  const workspace = useWorkspace();
  const inboxes = workspace.snapshot.topics.filter(isInboxTopic);
  const groups = inboxes.map((inbox) => ({
    inbox,
    subject: workspace.subjectById.get(inbox.subject_id),
    items: workspace.snapshot.entries
      .filter((entry) => entry.topic_id === inbox.id && entry.kind !== "lesson")
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  })).filter((group) => group.items.length)
    .sort((a, b) => (a.subject?.name ?? "").localeCompare(b.subject?.name ?? ""));
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return <div className="nb-scope nb-capture-review">
    <header className="nb-scope-head">
      <div>
        <button type="button" className="nb-review-back" onClick={onBack}>
          <ArrowLeft size={14} /> Notebook
        </button>
        <span className="ws-eyebrow">INBOX</span>
        <h1>Captures</h1>
        <p className="nb-review-intro">Your ideas are saved individually. Review them when ready, turn them into notes or flashcards, or file them into a topic.</p>
      </div>
    </header>
    {!total ? <div className="nb-review-empty">
      <Inbox size={24} />
      <strong>Nothing to organise</strong>
      <p>Quick Capture ideas appear here until you file them in your Notebook.</p>
    </div> : <div className="nb-review-groups">
      {groups.map(({ inbox, subject, items }) => <section key={inbox.id} className="nb-review-group">
        <header>
          <div><h2>{subject?.name ?? "Unsorted"}</h2><span>{items.length} {items.length === 1 ? "idea" : "ideas"} waiting</span></div>
          <button type="button" className="ws-button is-primary" onClick={() => workspace.openCleanup({ kind: "inbox", id: inbox.id })}>
            <ListChecks size={14} /> Organise <ArrowRight size={13} />
          </button>
        </header>
        <div className="nb-review-list">
          {items.map((entry) => <article key={entry.id} className="nb-review-item">
            <div className="nb-review-item-copy">
              <time>{new Date(entry.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time>
              <strong>{entry.kind === "mistake" ? entry.attempt || entry.correction : entryTitle(entry)}</strong>
              {entryPreview(entry, 220) ? <p>{entryPreview(entry, 220)}</p> : null}
            </div>
            {entry.kind === "note" ? <button type="button" className="ws-button is-small" onClick={() => onOpenNote(entry)}>
              <NotebookPen size={13} /> Open note
            </button> : <span className="nb-review-kind">Mistake</span>}
          </article>)}
        </div>
      </section>)}
    </div>}
  </div>;
}
