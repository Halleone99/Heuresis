import { useCallback, useState } from "react";
import { NotebookPen, RefreshCw } from "lucide-react";
import { DocumentPage } from "./DocumentPage";
import type { NewDocRequest } from "./NotebookView";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";
import { closeNoteWindow, openNoteWindow } from "../../lib/noteWindow";
import { friendlyError } from "../../lib/knowledgeWorkspace";
import type { NotebookLocation, WorkspaceSection } from "../../lib/workspaceMemory";

/** Existing detached notes open for reading; only new drafts start in edit mode. */
export function DetachedNoteWorkspace({ userId }: { userId: string }) {
  const [section, setSection] = useState<WorkspaceSection>("notebook");
  return <WorkspaceProvider userId={userId} section={section} onSection={setSection}>
    <DetachedNotePage />
  </WorkspaceProvider>;
}

function DetachedNotePage() {
  const workspace = useWorkspace();
  const [request] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      noteId: params.get("noteId"),
      topicId: params.get("topicId"),
      draftKey: params.get("draftKey") ?? crypto.randomUUID(),
    };
  });
  const [noteId, setNoteId] = useState(request.noteId);
  const [newDoc, setNewDoc] = useState<NewDocRequest>(
    request.noteId || !request.topicId ? null : { topicId: request.topicId, category: "note", draftKey: request.draftKey },
  );
  const entry = noteId ? workspace.entryById.get(noteId) ?? null : null;

  const close = useCallback(() => {
    void closeNoteWindow().catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
  }, [workspace]);

  const openAnother = useCallback((topicId: string | null) => {
    if (!topicId) { workspace.toast("Choose a topic before creating another note.", { tone: "error" }); return; }
    void openNoteWindow({ topicId }).catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
  }, [workspace]);

  const navigate = useCallback((next: NotebookLocation) => {
    if (next.docId) {
      void openNoteWindow({ noteId: next.docId }).catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
    } else {
      workspace.toast("Use the main Notebook window to browse subjects and topics.");
    }
  }, [workspace]);

  const created = useCallback((saved: { id: string }) => {
    setNoteId(saved.id);
    setNewDoc(null);
    const params = new URLSearchParams({ noteWindow: "1", noteId: saved.id });
    window.history.replaceState(null, "", `index.html?${params.toString()}`);
  }, []);

  return <div className="nb-detached-root">
    <header className="nb-window-top">
      <span className="nb-window-brand"><NotebookPen size={16} /> Heuresis <span> / Notebook</span></span>
    </header>
    <main className="nb-window-main">
      {workspace.loading ? <div className="nb-window-message"><span className="ws-spinner"/> Opening your note…</div>
        : workspace.error ? <div className="nb-window-message" role="alert">Could not load this note: {workspace.error}
          <button type="button" className="ws-button" onClick={() => void workspace.reload()}><RefreshCw size={14}/> Retry</button>
        </div>
          : noteId && !entry ? <div className="nb-window-message" role="alert">This note is not available. It may have been deleted.</div>
            : !entry && !newDoc ? <div className="nb-window-message">No note was selected.</div>
              : <DocumentPage key={request.noteId ?? request.draftKey} entry={entry} newDoc={newDoc}
                  onBack={close} onClose={close} navigate={navigate} onNewNote={openAnother}
                  onCreated={created} detached />}
    </main>
    {workspace.toasts.length ? <div className="nb-window-toasts" role="status">{workspace.toasts.map((item) =>
      <p key={item.id} className={item.tone === "error" ? "is-error" : ""}>{item.message}</p>)}</div> : null}
  </div>;
}
