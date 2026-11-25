import { useState } from "react";
import { ArrowUpRight, PanelsTopLeft, Pin, PinOff } from "lucide-react";
import { entryTitle, friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { findNotebookLink } from "../../lib/noteReference";
import { NoteWindowBlockedError, openNoteWindow } from "../../lib/noteWindow";
import { prefersSingleWindowNavigation } from "../../lib/platform";
import { quickQueueKind } from "../../lib/quickQueue";
import { NoteLessonView } from "./NoteLessonView";
import { ReferenceNoteList } from "./ReferenceNoteList";
import { useWorkspace } from "./WorkspaceContext";

export function NotebookBoard({ notes, query, selectedId, onSelect, onOpen }: {
  notes: KnowledgeEntry[];
  query: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen: (entry: KnowledgeEntry) => void;
}) {
  const workspace = useWorkspace();
  const [pinning, setPinning] = useState(false);
  const selected = notes.find((entry) => entry.id === selectedId) ?? notes[0];
  if (!selected) return <p className="nb-v2-empty">No notes match. Try a different search or filter.</p>;

  async function togglePin(entry: KnowledgeEntry) {
    setPinning(true);
    try { await workspace.patchEntry(entry.id, { pinned: !entry.pinned }); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
    finally { setPinning(false); }
  }

  return <div className="nb-v2-board" aria-label="Notes board">
    <aside className="nb-v2-board-nav" aria-label="Choose a note">
      <ReferenceNoteList notes={notes} activeId={selected.id} resetKey={query}
        onChoose={(entry) => onSelect(entry.id)}/>
    </aside>
    <section className="nb-v2-board-preview" aria-label="Note preview">
      <header className="nb-v2-board-head">
        <div>
          <h2>{entryTitle(selected)}</h2>
          {!quickQueueKind(selected) && selected.description.trim() ? <p>{selected.description}</p> : null}
        </div>
        <div className="nb-v2-actions">
          {workspace.writable ? <button type="button" className="ws-icon-button" disabled={pinning}
            aria-label={selected.pinned ? "Unpin note" : "Pin note"} title={selected.pinned ? "Unpin note" : "Pin note"}
            onClick={() => { onSelect(selected.id); void togglePin(selected); }}>
            {selected.pinned ? <PinOff size={16}/> : <Pin size={16}/>}
          </button> : null}
          {!prefersSingleWindowNavigation() ? <button type="button" className="ws-icon-button"
            aria-label="Open lesson companion" title="Open lesson companion"
            onClick={() => void openNoteWindow({ noteId: selected.id, companion: true }).catch((error) => {
              if (error instanceof NoteWindowBlockedError) workspace.toast("Pop-up blocked. You can use the preview here.");
              else workspace.toast(friendlyError(error), { tone: "error" });
            })}><PanelsTopLeft size={17}/></button> : null}
          <button type="button" className="ws-button nb-v2-open" onClick={() => onOpen(selected)}>Open note <ArrowUpRight size={15}/></button>
        </div>
      </header>
      <NoteLessonView key={selected.id} text={selected.body} suggestedQuery={query} resolve={(target) => {
        const match = findNotebookLink(target, selected.topic_id, workspace.snapshot.entries, workspace.topicById);
        return { exists: Boolean(match), open: match ? () => onOpen(match) : undefined };
      }}/>
    </section>
  </div>;
}
