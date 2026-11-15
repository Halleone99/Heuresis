import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

type Props = {
  value: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
  onCommit: (value: string) => Promise<void>;
};

/** Plain fields only. Formatted workspace blocks use RichEditor instead. */
export function InlineSortText({ value, label, placeholder, required, multiline, disabled, className = "", onEditingChange, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const original = useRef(value);
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { setDraft(value); original.current = value; }, [value]);

  function focus() {
    original.current = value;
    cancelled.current = false;
    setError("");
    onEditingChange?.(true);
  }

  async function blur() {
    onEditingChange?.(false);
    if (cancelled.current) { cancelled.current = false; setDraft(original.current); return; }
    const next = draft.trim();
    if (required && !next) {
      setDraft(original.current);
      setError(label + " is required");
      return;
    }
    if (next === original.current.trim()) return;
    try { await onCommit(next); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save"); setDraft(original.current); }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      cancelled.current = true; setDraft(original.current); event.currentTarget.blur();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.blur();
    }
  }

  const attrs = { ref: field, "aria-label": label, "aria-invalid": Boolean(error), disabled, className: "sort-inline-text " + className,
    placeholder, value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onFocus: focus, onBlur: () => { void blur(); }, onKeyDown: keyDown };
  return <span className="sort-inline-wrap">
    {multiline ? <textarea {...attrs} rows={2} /> : <input {...attrs} type="text" />}
    {error ? <small role="alert" className="sort-inline-error">{error}</small> : null}
  </span>;
}
