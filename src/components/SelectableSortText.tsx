import { useState } from "react";
import { Pencil } from "lucide-react";
import { InlineSortText } from "./InlineSortText";

type Props = {
  value: string; label: string; language: string; placeholder?: string;
  required?: boolean; multiline?: boolean; disabled?: boolean;
  className?: string; onEditingChange?: (editing: boolean) => void;
  onCommit: (text: string) => Promise<void>;
};

/** Readable/selectable by default, editable on explicit Pencil click. */
export default function SelectableSortText({
  value, label, language, placeholder, required, multiline, disabled, className = "", onEditingChange, onCommit,
}: Props) {
  const [editing, setEditing] = useState(false);
  if (editing) return <InlineSortText value={value} label={label} placeholder={placeholder}
    required={required} multiline={multiline} disabled={disabled} autoFocus className={className}
    onEditingChange={(active) => { onEditingChange?.(active); if (!active) setEditing(false); }}
    onCommit={onCommit} />;
  return <span className={"sort-selectable " + className}>
    <span className={value ? "" : "is-empty"} data-hl={value ? "" : undefined} lang={language}>{value || placeholder || ""}</span>
    <button type="button" className="sort-selectable-pencil" disabled={disabled} title={"Edit " + label}
      aria-label={"Edit " + label} onClick={() => setEditing(true)}><Pencil size={15}/></button>
  </span>;
}
