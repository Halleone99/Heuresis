import { useEffect, useMemo, useState } from "react";
import { Feather, Inbox, PenLine, Trash2 } from "lucide-react";
import { createCard, listCollections, listPacks, type Collection, type PackWithType } from "../../lib/heuresis";
import { markCaptureCleaned, useCaptureReviewIds } from "../../lib/captureReviewQueue";
import { HAND_NOTE_PREFIX } from "../../lib/handNote";
import { friendlyError, plainLine, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { quickQueueKind, quickQueuePair, type QuickQueueKind } from "../../lib/quickQueue";
import { RichText } from "./RichText";
import { useWorkspace } from "./WorkspaceContext";
import "./q-queue.css";

const names: Record<QuickQueueKind, string> = {
  raw: "Note", note: "Note", flashcard: "Flashcard", mistake: "Mistake",
};
type Filter = "all" | QuickQueueKind;
function kindOf(entry: KnowledgeEntry, legacy: Set<string>, inboxIds: Set<string>): QuickQueueKind | null {
  // A capture moved to a real topic is no longer waiting, even on an old device.
  if (!inboxIds.has(entry.topic_id)) return null;
  const marker = quickQueueKind(entry);
  if (marker) return marker === "raw" ? "note" : marker;
  if (!legacy.has(entry.id)) return null;
  return entry.kind === "mistake" ? "mistake" : "note";
}
function entryContent(entry: KnowledgeEntry) {
  return entry.kind === "mistake"
    ? `Mistake: ${entry.attempt}\nCorrection: ${entry.correction}`
    : entry.body;
}
function capturePreview(entry: KnowledgeEntry) {
  if (entry.kind !== "mistake" && entry.title.trim()) return entry.title.trim().slice(0, 140);
  const content = entryContent(entry);
  if (!content.includes(HAND_NOTE_PREFIX)) return content.slice(0, 140);
  // Pages and handwritten notes: the first line of text, never the drawing data.
  return (plainLine(content) || "✎ Handwriting").slice(0, 140);
}
export function QQueuePage({ onCapture }: { onCapture: () => void }) {
  const workspace = useWorkspace();
  const legacy = useCaptureReviewIds(workspace.userId);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [packId, setPackId] = useState("");
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inboxIds = useMemo(() => new Set(workspace.snapshot.topics.filter(isInboxTopic).map((topic) => topic.id)), [workspace.snapshot.topics]);
  const queue = useMemo(() => workspace.snapshot.entries
    .filter((entry) => kindOf(entry, legacy, inboxIds))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [workspace.snapshot.entries, legacy, inboxIds]);
  const visible = queue.filter((entry) => filter === "all" || kindOf(entry, legacy, inboxIds) === filter);
  const selected = visible.find((entry) => entry.id === activeId) ?? visible[0] ?? null;
  const kind = selected ? kindOf(selected, legacy, inboxIds) : null;
  const subjects = workspace.snapshot.subjects;
  const topics = workspace.snapshot.topics.filter((topic) => topic.subject_id === subjectId);
  const shownPacks = packs.filter((pack) => pack.collection_id === collectionId);
  // Handwriting and formatted pages are shown as they will read in the Notebook;
  // only plain text is edited here, so drawing data is never exposed as text.
  const hasStrokes = body.includes(HAND_NOTE_PREFIX);

  useEffect(() => {
    if (!selected) return;
    setBody(entryContent(selected));
    setSubjectId("");
    setTopicId("");
    setCollectionId("");
    setPackId("");
    setError("");
  }, [selected?.id]); // Selection changes reset the review editor; edits do not.
  useEffect(() => {
    let active = true;
    Promise.all([listCollections(), listPacks()])
      .then(([collectionsResult, packsResult]) => {
        if (!active) return;
        setCollections(collectionsResult); setPacks(packsResult);
      }).catch(() => { /* Study destination is optional until a card is converted. */ });
    return () => { active = false; };
  }, []);

  async function finish() {
    if (!selected || !kind || busy) return;
    setBusy(true); setError("");
    try {
      // A file action must choose a real topic, never silently confirm the Inbox.
      const target = topicId;
      let destinationLabel = "";
      if (kind === "raw" || kind === "note" || hasStrokes) {
        if (!target) throw new Error("Choose a collection before filing the note.");
        await workspace.patchEntry(selected.id, { topic_id: target, body, description: "" });
        destinationLabel = workspace.pathLabel(target);
      } else if (kind === "mistake") {
        if (!target) throw new Error("Choose a collection for the Mistake Log.");
        const [wrong, correct] = quickQueuePair("mistake", body);
        if (!wrong.trim() || !correct.trim()) throw new Error("Both mistake and correction are needed.");
        await workspace.addEntry({ kind: "mistake", topicId: target,
          attempt: wrong.trim(), correction: correct.trim(), category: "note" });
        await workspace.removeEntry(selected.id, { undo: false });
        destinationLabel = workspace.pathLabel(target);
      } else {
        const pack = packs.find((candidate) => candidate.id === packId);
        if (!pack) throw new Error("Choose a Study deck.");
        const schema = pack.cardType?.field_schema ?? [];
        const frontField = schema.find((field) => field.role === "term") ?? schema[0];
        const backField = schema.find((field) => field.role === "meaning") ?? schema.find((field) => field.key !== frontField?.key);
        if (!frontField || !backField) throw new Error("This deck requires a different card format.");
        const [front, back] = quickQueuePair("flashcard", body);
        if (!front.trim() || !back.trim()) throw new Error("Both sides of the flashcard are needed.");
        await createCard(pack, { [frontField.key]: front.trim(), [backField.key]: back.trim() }, "Captures");
        window.dispatchEvent(new CustomEvent("heuresis:study-changed"));
        await workspace.removeEntry(selected.id, { undo: false });
        destinationLabel = pack.title;
      }
      markCaptureCleaned(workspace.userId, selected.id);
      setActiveId(null);
      workspace.toast(`Filed to ${destinationLabel}.`);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      await workspace.removeEntry(selected.id);
      // Keep old device-local IDs for legacy captures so Undo restores them to this list.
      setActiveId(null);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  const filters: Filter[] = ["all", "note", "flashcard", "mistake"];
  return <section className="q-page">
    <header className="q-page-head">
      <div><span className="q-overline">CAPTURES</span><h1>Captures</h1>
        <p>Everything you capture waits here until you decide where it belongs.</p></div>
      <button className="q-primary" type="button" onClick={onCapture}><Feather size={16}/> Capture</button>
    </header>
    <div className="q-filterbar" role="group" aria-label="Filter quick captures">
      {filters.map((item) => <button key={item} type="button"
        aria-pressed={filter === item} className={filter === item ? "active" : ""}
        onClick={() => { setFilter(item); setActiveId(null); }}>
        {item === "all" ? "All" : names[item]} <span>{queue.filter((entry) => item === "all" || kindOf(entry, legacy, inboxIds) === item).length}</span>
      </button>)}
    </div>
    {!queue.length ? <div className="q-empty"><Inbox size={27}/><strong>Nothing waiting</strong>
      <p>Quick notes, flashcards and mistakes captured with the feather appear here.</p></div>
      : <div className="q-grid">
        <div className="q-list" aria-label="Captures awaiting review">
          {visible.map((entry) => {
            const label = kindOf(entry, legacy, inboxIds)!;
            return <button key={entry.id} className={selected?.id === entry.id ? "active" : ""}
              type="button" onClick={() => { setActiveId(entry.id); }}>
              <span className="q-list-line"><strong>{names[label]}</strong><time>{new Date(entry.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></span>
              <span className="q-preview">{capturePreview(entry) || "Handwriting"}</span>
            </button>;
          })}
          {!visible.length && <p className="q-filter-empty">No captures in this category.</p>}
        </div>
        {selected && kind ? <article className="q-review" key={selected.id}>
          <header><span className="q-overline">REVIEW · {names[kind].toUpperCase()}</span>
            <button type="button" className="q-delete-link" onClick={() => void remove()}>
              <Trash2 size={15}/> Discard
            </button></header>
          {selected.kind !== "mistake" && selected.title.trim() ? <h2 className="q-review-title">{selected.title}</h2> : null}
          {hasStrokes ? <>
            <div className="q-review-read"><RichText text={body} /></div>
            <button type="button" className="q-delete-link q-edit-link" onClick={() => workspace.openDocument(selected.id, { edit: true })}>
              <PenLine size={15}/> Edit in the Notebook editor
            </button>
          </> : <textarea aria-label="Edit captured content" value={body}
            onChange={(event) => setBody(event.target.value)} />}
          <div className="q-review-destination">
            {kind === "flashcard" && !hasStrokes ? <>
              <label>Language / collection<select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); setPackId(""); }}>
                <option value="">Choose language</option>
                {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}
              </select></label>
              <label>Study deck<select value={packId} onChange={(event) => setPackId(event.target.value)}>
                <option value="">Choose deck</option>
                {shownPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}
              </select></label>
            </> : <>
              <label>Subject<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); }}>
                <option value="">Choose subject</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select></label>
              <label>Topic<select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
                <option value="">Choose topic</option>
                {topics.filter((topic) => topic.name.toLowerCase() !== "inbox").map((topic) =>
                  <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select></label>
            </>}
          </div>
          {error ? <p className="q-capture-error" role="alert">{error}</p> : null}
          <footer><span>Saved until you file it.</span>
            <button className="q-primary" type="button" disabled={busy || (kind === "flashcard" && !hasStrokes ? !packId : !topicId)} onClick={() => void finish()}>
              {busy ? "Filing…" : kind === "flashcard" && !hasStrokes ? "Create flashcard" : kind === "mistake" && !hasStrokes ? "Add to Mistake Log" : "File as note"}
            </button>
          </footer>
        </article> : null}
      </div>}
  </section>;
}
