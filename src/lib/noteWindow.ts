import { isAndroidRuntime } from "./platform";

/**
 * Every note uses a unique window label. Several different notes can remain
 * open at once; all of them save through the ordinary Notebook database.
 */
export type NoteWindowLaunch = { noteId?: string; topicId?: string };

export async function openNoteWindow({ noteId, topicId }: NoteWindowLaunch): Promise<void> {
  if (!noteId && !topicId) throw new Error("Choose a note or topic first.");
  if (isAndroidRuntime()) throw new Error("Separate note windows are available on desktop. Notes still open normally on your tablet.");

  const windowId = crypto.randomUUID();
  const params = new URLSearchParams({ noteWindow: "1" });
  if (noteId) params.set("noteId", noteId);
  else {
    params.set("topicId", topicId!);
    // Independent drafts: three blank note windows must never overwrite each other.
    params.set("draftKey", windowId);
  }
  const url = `index.html?${params.toString()}`;

  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const popup = new WebviewWindow(`notebook-${windowId}`, {
      url, title: "Note · Heuresis", width: 900, height: 760,
      minWidth: 540, minHeight: 440, center: true, focus: true,
      resizable: true, decorations: true, alwaysOnTop: false,
    });
    await new Promise<void>((resolve, reject) => {
      void popup.once("tauri://created", () => resolve());
      void popup.once("tauri://error", (event) => reject(new Error(`Could not open note window: ${String(event.payload)}`)));
    });
    return;
  }

  // Different named windows are intentional: never reuse/reload another open note.
  const popup = window.open(url, `heuresis-note-${windowId}`, "popup,width=900,height=760,resizable=yes,scrollbars=yes");
  if (!popup) throw new Error("Your browser blocked the note window. Allow pop-ups for Heuresis.");
  popup.focus();
}

export async function closeNoteWindow(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
  } else window.close();
}
