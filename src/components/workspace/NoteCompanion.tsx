import { useDeferredValue, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, NotebookPen, Pin, Search, X } from "lucide-react";
import { entryTitle, friendlyError, isDocument, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { findNotebookLink, matchesReference, noteReferenceText, referenceTerms } from "../../lib/noteReference";
import { closeNoteWindow } from "../../lib/noteWindow";
import { NoteLessonView } from "./NoteLessonView";
import { ReferenceNoteList } from "./ReferenceNoteList";
import { useWorkspace } from "./WorkspaceContext";

const PIN_KEY = "heuresis.note-companion.pinned";

export function NoteCompanion({ initialId }: { initialId: string }) {
  const workspace = useWorkspace();
  const [noteId, setNoteId] = useState(initialId);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
  const [pinnedWindow, setPinnedWindow] = useState(() => {
    try { return sessionStorage.getItem(PIN_KEY) === "true"; }
    catch { return false; }
  });
  const [pinningWindow, setPinningWindow] = useState(false);
  const browseButton = useRef<HTMLButtonElement>(null);

  const entry = workspace.entryById.get(noteId);
  const subjectId = entry ? workspace.topicById.get(entry.topic_id)?.subject_id : undefined;
  const subject = subjectId ? workspace.subjectById.get(subjectId) : undefined;
  const notes = useMemo(() => workspace.snapshot.entries.filter((item) => isDocument(item)
    && (!subjectId || workspace.topicById.get(item.topic_id)?.subject_id === subjectId))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)),
  [subjectId, workspace.snapshot.entries, workspace.topicById]);
  const deferredSearch = useDeferredValue(search);
  const searching = Boolean(deferredSearch.trim());
  const searchIndex = useMemo(() => searching ? new Map(notes.map((item) => [item.id, noteReferenceText(item)])) : null,
    [notes, searching]);
  const results = useMemo(() => {
    const terms = referenceTerms(deferredSearch);
    return searchIndex ? notes.filter((item) => matchesReference(searchIndex.get(item.id) ?? "", terms)) : notes;
  }, [deferredSearch, notes, searchIndex]);

  const showError = (error: unknown) => workspace.toast(friendlyError(error), { tone: "error" });
  function closePicker() {
    setChoosing(false);
    setSearch("");
    browseButton.current?.focus();
  }
  function choose(next: KnowledgeEntry, query = "") {
    setNoteId(next.id);
    setNoteQuery(query);
    closePicker();
    const url = new URL(window.location.href);
    url.searchParams.set("noteId", next.id);
    window.history.replaceState(null, "", url);
    window.scrollTo(0, 0);
  }
  async function toggleWindowPin() {
    setPinningWindow(true);
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setAlwaysOnTop(!pinnedWindow);
      setPinnedWindow(!pinnedWindow);
      try { sessionStorage.setItem(PIN_KEY, String(!pinnedWindow)); } catch { /* Optional window preference. */ }
    } catch (error) { showError(error); }
    finally { setPinningWindow(false); }
  }
  const fullNoteUrl = `?noteWindow=1&noteId=${encodeURIComponent(noteId)}&fromCompanion=1`;

  return <div className="nb-detached-root nb-notes-v2 nb-v2-companion">
    <header className="nb-window-top" onKeyDown={(event) => {
      if (event.key === "Escape" && choosing && !event.nativeEvent.isComposing) {
        event.preventDefault();
        closePicker();
      }
    }}>
      <span className="nb-window-brand"><NotebookPen size={17}/> Lesson companion</span>
      <div className="nb-window-actions">
        {"__TAURI_INTERNALS__" in window ? <button type="button" className="ws-icon-button" aria-label="Always on top"
          aria-pressed={pinnedWindow} title="Always on top" onClick={() => void toggleWindowPin()} disabled={pinningWindow}>
          <Pin size={16} fill={pinnedWindow ? "currentColor" : "none"}/>
        </button> : null}
        <button type="button" className="ws-icon-button" aria-label="Close companion" title="Close companion"
          onClick={() => void closeNoteWindow().catch(showError)}><X size={18}/></button>
      </div>
      <div className="nb-v2-companion-picker">
        <button type="button" className="nb-v2-choose-note" ref={browseButton} aria-expanded={choosing} aria-controls={choosing ? "companion-notes" : undefined}
          disabled={workspace.loading || Boolean(workspace.error)}
          onClick={() => { if (choosing) closePicker(); else { setChoosing(true); window.scrollTo(0, 0); } }}>
          <span>{subject?.name ?? "Notebook"} notes</span><ChevronDown size={15}/>
        </button>
        {choosing ? <div id="companion-notes" className="nb-v2-companion-picker-panel">
          <label className="nb-v2-search"><Search size={16} aria-hidden="true"/>
            <input type="search" autoFocus placeholder="Find notes or phrases…" aria-label="Find notes or phrases"
              value={search} onChange={(event) => setSearch(event.target.value)}/>
          </label>
          {results.length ? <ReferenceNoteList notes={results} activeId={noteId} resetKey={deferredSearch}
            onChoose={(item) => choose(item, search)} detail={(item) => workspace.topicById.get(item.topic_id)?.name ?? ""}/>
            : <p className="nb-v2-empty">No notes match this search.</p>}
        </div> : null}
      </div>
    </header>
    <main className="nb-v2-companion-main">
      {workspace.loading ? <p className="nb-v2-empty" role="status">Opening your note…</p>
        : workspace.error ? <div className="nb-v2-empty" role="alert">Could not load this note.
          <button type="button" className="ws-button" onClick={() => void workspace.reload()}>Retry</button>
        </div>
          : !entry || !isDocument(entry) ? <p className="nb-v2-empty">This note is unavailable. Choose another above.</p>
            : <>
              <div className="nb-v2-companion-heading">
                <div><p>{workspace.topicById.get(entry.topic_id)?.name}</p><h1>{entryTitle(entry)}</h1></div>
                <a href={fullNoteUrl} className="ws-icon-button" title="Open full note" aria-label="Open full note"><ArrowUpRight size={18}/></a>
              </div>
              <NoteLessonView key={`${entry.id}:${noteQuery}`} text={entry.body} suggestedQuery={noteQuery} resolve={(target) => {
                const match = findNotebookLink(target, entry.topic_id, workspace.snapshot.entries, workspace.topicById);
                return { exists: Boolean(match), open: match ? () => choose(match) : undefined };
              }}/>
            </>}
    </main>
    {workspace.toasts.length ? <div className="nb-window-toasts" role="status">
      {workspace.toasts.map((item) => <p key={item.id} className={item.tone === "error" ? "is-error" : ""}>{item.message}</p>)}
    </div> : null}
  </div>;
}
