import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import type { KeyboardEvent } from "react";

type Props = {
  value: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
  onCommit: (value: string) => Promise<void>;
};

/** Plain fields only. Formatted workspace blocks use RichEditor instead. */
export function InlineSortText({ value, label, placeholder, required, multiline, disabled, autoFocus, className = "", onEditingChange, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const original = useRef(value);
  const cancelled = useRef(false);
  const editing = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // Never overwrite what the person is typing with a value that arrived from elsewhere.
  useEffect(() => { if (!editing.current) { setDraft(value); original.current = value; } }, [value]);

  // Multi-line fields grow with their text instead of scrolling inside two rows.
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = node.scrollHeight + 2 + "px";
  }, [draft, multiline]);

  // A field that is still marked as being edited when it disappears must not lock the session.
  useEffect(() => () => { if (editing.current) onEditingChange?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function focus() {
    original.current = value;
    cancelled.current = false;
    editing.current = true;
    setError("");
    onEditingChange?.(true);
  }

  function blur(): Promise<void> | void {
    editing.current = false;
    onEditingChange?.(false);
    if (cancelled.current) { cancelled.current = false; setDraft(original.current); return; }
    const next = draft.trim();
    if (required && !next) {
      setDraft(original.current);
      setError(label + " is required");
      window.setTimeout(() => setError(""), 2400);
      return;
    }
    if (next === original.current.trim()) return;
    // onCommit starts synchronously here, so a click that caused this blur can wait for the save.
    return onCommit(next).then(() => { original.current = next; setError(""); }, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Could not save");
      setDraft(original.current);
    });
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      cancelled.current = true; setDraft(original.current); event.currentTarget.blur();
    } else if (event.key === "Enter") {
      // Keep card-level shortcuts out of every editor, including multiline fields.
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      // Native textarea Enter inserts a newline; only single-line fields commit.
      if (!multiline && !event.shiftKey) {
        event.preventDefault(); event.currentTarget.blur();
      }
    }
  }

  const attrs = { "aria-label": label, "aria-invalid": Boolean(error), disabled, autoFocus, className: "sort-inline-text " + className,
    placeholder, value: draft, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onFocus: focus, onBlur: () => { void blur(); }, onKeyDown: keyDown, spellCheck: false };
  return <span className="sort-inline-wrap">
    {multiline ? <textarea ref={area} {...attrs} rows={1} /> : <input {...attrs} type="text" />}
    {error ? <small role="alert" className="sort-inline-error">{error}</small> : null}
  </span>;
}
