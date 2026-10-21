import { useEffect, useMemo, useState } from "react";
import { Feather, Inbox, Trash2 } from "lucide-react";
import { createCard, listCollections, listPacks, type Collection, type PackWithType } from "../../lib/heuresis";
import { markCaptureCleaned, useCaptureReviewIds } from "../../lib/captureReviewQueue";
import { decodeHandNote, HAND_NOTE_PREFIX } from "../../lib/handNote";
import { friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { quickQueueKind, quickQueuePair, type QuickQueueKind } from "../../lib/quickQueue";
import { HandNoteDrawing } from "./HandNotePad";
import { useWorkspace } from "./WorkspaceContext";
import "./q-queue.css";

const names: Record<QuickQueueKind, string> = {
  raw: "Raw", note: "Note", flashcard: "Flashcard", mistake: "Mistake",
};
type Filter = "all" | QuickQueueKind;
function kindOf(entry: KnowledgeEntry, legacy: Set<string>): QuickQueueKind | null {
  const marker = quickQueueKind(entry);
  if (marker) return marker;
  if (!legacy.has(entry.id)) return null;
  return entry.kind === "mistake" ? "mistake" : "note";
}
function entryContent(entry: KnowledgeEntry) {
  return entry.kind === "mistake"
    ? `Mistake: ${entry.attempt}\nCorrection: ${entry.correction}`
    : entry.body;
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const queue = useMemo(() => workspace.snapshot.entries
    .filter((entry) => kindOf(entry, legacy))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [workspace.snapshot.entries, legacy]);
  const visible = queue.filter((entry) => filter === "all" || kindOf(entry, legacy) === filter);
  const selected = visible.find((entry) => entry.id === activeId) ?? visible[0] ?? null;
  const kind = selected ? kindOf(selected, legacy) : null;
  const subjects = workspace.snapshot.subjects;
  const topics = workspace.snapshot.topics.filter((topic) => topic.subject_id === subjectId);
  const shownPacks = packs.filter((pack) => pack.collection_id === collectionId);
  const strokesStart = body.indexOf(HAND_NOTE_PREFIX);
  const hasStrokes = strokesStart !== -1;
  const strokes = hasStrokes ? decodeHandNote(body.slice(strokesStart).trim()) : [];
  const readableBody = hasStrokes ? body.slice(0, strokesStart).trim() : body;

  useEffect(() => {
    if (!selected) return;
    setBody(entryContent(selected));
    setSubjectId(workspace.topicById.get(selected.topic_id)?.subject_id ?? "");
    setTopicId("");
    setCollectionId("");
    setPackId("");
    setConfirmDelete(false);
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
      const target = topicId || (subjectId ? (await workspace.ensureInbox(subjectId)).id : "");
      if (kind === "raw" || kind === "note" || (hasStrokes && kind !== "note")) {
        if (!target) throw new Error("Choose a collection before filing the note.");
        await workspace.patchEntry(selected.id, { topic_id: target, body, description: "" });
      } else if (kind === "mistake") {
        if (!target) throw new Error("Choose a collection for the Mistake Log.");
        const [wrong, correct] = quickQueuePair("mistake", body);
        if (!wrong.trim() || !correct.trim()) throw new Error("Both mistake and correction are needed.");
        await workspace.addEntry({ kind: "mistake", topicId: target,
          attempt: wrong.trim(), correction: correct.trim(), category: "note" });
        await workspace.removeEntry(selected.id, { undo: false });
      } else {
        const pack = packs.find((candidate) => candidate.id === packId);
        if (!pack) throw new Error("Choose a Study deck.");
        const schema = pack.cardType?.field_schema ?? [];
        const frontField = schema.find((field) => field.role === "term") ?? schema[0];
        const backField = schema.find((field) => field.role === "meaning") ?? schema.find((field) => field.key !== frontField?.key);
        if (!frontField || !backField) throw new Error("This deck requires a different card format.");
        const [front, back] = quickQueuePair("flashcard", body);
        if (!front.trim() || !back.trim()) throw new Error("Both sides of the flashcard are needed.");
        await createCard(pack, { [frontField.key]: front.trim(), [backField.key]: back.trim() }, "Quick Capture Q");
        window.dispatchEvent(new CustomEvent("heuresis:study-changed"));
        await workspace.removeEntry(selected.id, { undo: false });
      }
      markCaptureCleaned(workspace.userId, selected.id);
      setActiveId(null);
      workspace.toast("Filed from Q.");
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      await workspace.removeEntry(selected.id, { undo: false });
      markCaptureCleaned(workspace.userId, selected.id);
      setConfirmDelete(false); setActiveId(null);
      workspace.toast("Capture discarded.");
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  const filters: Filter[] = ["all", "raw", "note", "flashcard", "mistake"];
  return <section className="q-page">
    <header className="q-page-head">
      <div><span className="q-overline">HEURESIS · QUICK QUEUE</span><h1><em>Q</em> Captures</h1>
        <p>Everything you capture waits here until you decide where it belongs.</p></div>
      <button className="q-primary" type="button" onClick={onCapture}><Feather size={16}/> Capture</button>
    </header>
    <div className="q-filterbar" role="group" aria-label="Filter quick captures">
      {filters.map((item) => <button key={item} type="button"
        aria-pressed={filter === item} className={filter === item ? "active" : ""}
        onClick={() => { setFilter(item); setActiveId(null); }}>
        {item === "all" ? "All" : names[item]} <span>{queue.filter((entry) => item === "all" || kindOf(entry, legacy) === item).length}</span>
      </button>)}
    </div>
    {!queue.length ? <div className="q-empty"><Inbox size={27}/><strong>Your Q is clear</strong>
      <p>Quick notes, flashcards and mistakes captured with the feather appear here.</p></div>
      : <div className="q-grid">
        <div className="q-list" aria-label="Captures awaiting review">
          {visible.map((entry) => {
            const label = kindOf(entry, legacy)!;
            return <button key={entry.id} className={selected?.id === entry.id ? "active" : ""}
              type="button" onClick={() => { setActiveId(entry.id); }}>
              <span className="q-list-line"><strong>{names[label]}</strong><time>{new Date(entry.created_at).toLocaleDateString()}</time></span>
              <span className="q-preview">{entryContent(entry).replace(HAND_NOTE_PREFIX, " ✎ ").slice(0, 140) || "Handwriting"}</span>
            </button>;
          })}
          {!visible.length && <p className="q-filter-empty">No captures in this category.</p>}
        </div>
        {selected && kind ? <article className="q-review" key={selected.id}>
          <header><span className="q-overline">REVIEW · {names[kind].toUpperCase()}</span>
            <button type="button" className="q-delete-link" onClick={() => setConfirmDelete((current) => !current)}>
              <Trash2 size={15}/> Discard
            </button></header>
          {confirmDelete ? <div className="q-confirm">Discard this capture permanently?
            <button type="button" disabled={busy} onClick={() => void remove()}>Discard</button>
            <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div> : null}
          {hasStrokes ? <>
            {readableBody ? <p className="q-caption">{readableBody}</p> : null}
            <HandNoteDrawing strokes={strokes}/>
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
              <label>Collection<select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); }}>
                <option value="">Choose collection</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select></label>
              <label>Topic / folder<select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
                <option value="">Inbox · unsorted</option>
                {topics.filter((topic) => topic.name.toLowerCase() !== "inbox").map((topic) =>
                  <option key={topic.id} value={topic.id}>{topic.name}</option>)}
              </select></label>
            </>}
          </div>
          {error ? <p className="q-capture-error" role="alert">{error}</p> : null}
          <footer><span>Only filing makes this permanent knowledge.</span>
            <button className="q-primary" type="button" disabled={busy} onClick={() => void finish()}>
              {busy ? "Filing…" : kind === "flashcard" && !hasStrokes ? "Create flashcard" : kind === "mistake" && !hasStrokes ? "Add to Mistake Log" : "File as note"}
            </button>
          </footer>
        </article> : null}
      </div>}
  </section>;
}
