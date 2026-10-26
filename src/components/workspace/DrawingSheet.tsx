import type { KeyboardEvent } from "react";
import { Trash2 } from "lucide-react";
import { HandNotePad } from "./HandNotePad";
import type { HandNote } from "../../lib/handNote";
import "./q-queue.css";

/**
 * A drawing being added to, or changed in, a formatted page. "inset" covers the
 * page it belongs to (Capture); "dialog" covers the window (Notebook editor).
 * Escape keeps the drawing, so no stroke is ever lost to a stray key.
 */
export function DrawingSheet({ note, onNoteChange, editing, onDone, onRemove, onCancel, layout = "inset" }: {
  note: HandNote; onNoteChange: (note: HandNote) => void; editing: boolean;
  onDone: () => void; onRemove?: () => void; onCancel: () => void; layout?: "inset" | "dialog";
}) {
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys typed here belong to the drawing, never to the page or app shortcuts behind it.
    event.stopPropagation();
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onDone();
  }
  const sheet = <div className={`ink-sheet ${layout === "dialog" ? "is-dialog" : ""}`} role={layout === "dialog" ? "dialog" : "group"}
    aria-modal={layout === "dialog" ? true : undefined} aria-label={editing ? "Edit drawing" : "New drawing"} onKeyDown={keyDown}>
    <HandNotePad value={note} onChange={onNoteChange} variant="sheet" autoFocus />
    <div className="ink-sheet-foot">
      <button type="button" className="ink-quiet" onClick={onCancel}>Cancel</button>
      {editing && onRemove ? <button type="button" className="ink-quiet is-danger" onClick={onRemove}>
        <Trash2 size={15} aria-hidden="true" /> Remove drawing</button> : null}
      <span className="hn-spacer" />
      <button type="button" className="q-primary" onClick={onDone} disabled={!note.strokes.length && !editing}>
        {editing ? "Update drawing" : "Insert drawing"}</button>
    </div>
  </div>;
  return layout === "dialog" ? <div className="ink-sheet-backdrop">{sheet}</div> : sheet;
}
