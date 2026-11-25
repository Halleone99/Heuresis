import { prefersSingleWindowNavigation } from "./platform";

/**
 * Every note uses a unique window label. Several different notes can remain
 * open at once; all of them save through the ordinary Notebook database.
 */
export type NoteWindowLaunch =
  | { noteId: string; topicId?: never; companion?: boolean }
  | { topicId: string; noteId?: never; companion?: never };

export class NoteWindowBlockedError extends Error {}

export async function openNoteWindow({ noteId, topicId, companion }: NoteWindowLaunch): Promise<void> {
  if (!noteId && !topicId) throw new Error("Choose a note or topic first.");
  if (prefersSingleWindowNavigation()) throw new Error("Separate note windows are available on desktop. Notes still open normally in Notebook.");

  const windowId = crypto.randomUUID();
  const params = new URLSearchParams({ noteWindow: "1" });
  if (companion) params.set("companion", "1");
  if (noteId) params.set("noteId", noteId);
  else {
    params.set("topicId", topicId!);
    // Independent drafts: three blank note windows must never overwrite each other.
    params.set("draftKey", windowId);
  }
  const url = `index.html?${params.toString()}`;
  const width = companion ? 490 : 900;
  const height = companion ? 680 : 760;

  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const popup = new WebviewWindow(`notebook-${windowId}`, {
      url, title: companion ? "Lesson Companion · Heuresis" : "Note · Heuresis", width, height,
      minWidth: companion ? 320 : 540, minHeight: companion ? 360 : 440, center: true, focus: true,
      resizable: true, decorations: true, alwaysOnTop: false,
    });
    await new Promise<void>((resolve, reject) => {
      void popup.once("tauri://created", () => resolve());
      void popup.once("tauri://error", (event) => reject(new Error(`Could not open note window: ${String(event.payload)}`)));
    });
    return;
  }

  // A companion can enter the full editor, so a second launch needs its own window.
  const popup = window.open(url, `heuresis-note-${windowId}`, `popup,width=${width},height=${height},resizable=yes,scrollbars=yes`);
  if (!popup) throw new NoteWindowBlockedError("Your browser blocked the note window. Allow pop-ups for Heuresis.");
  popup.focus();
}

export async function closeNoteWindow(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
  } else window.close();
}
