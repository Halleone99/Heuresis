import { useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Brain, GraduationCap, Headphones, MessageSquareText, Pencil, Plus, Target, Trash2, TriangleAlert, X } from "lucide-react";
import { ICON_CHOICES, createMistakeMode, deleteMistakeMode, updateMistakeMode, type MistakeMode, type ModeInput } from "../../lib/mistakeModes";
import { friendlyError } from "../../lib/knowledgeWorkspace";
import { Portal } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const glyphs: Record<string, typeof BookOpen> = {
  "icon:graduation": GraduationCap, "icon:book": BookOpen, "icon:message": MessageSquareText,
  "icon:warning": TriangleAlert, "icon:brain": Brain, "icon:target": Target,
  "icon:headphones": Headphones, "icon:pen": Pencil,
};
export function ModeSymbol({ symbol, size = 23 }: { symbol: string; size?: number }) {
  const Icon = glyphs[symbol];
  return Icon ? <Icon size={size} aria-hidden="true" /> : <span className="ml-emoji" aria-hidden="true">{symbol}</span>;
}
export function MistakeModeDialog({
  mode, maxOrder, position, total, onClose, onChanged, onMove,
}: {
  mode: MistakeMode | null; maxOrder: number; position: number; total: number;
  onClose: () => void; onChanged: () => Promise<void>; onMove: (direction: -1 | 1) => Promise<void>;
}) {
  const { userId } = useWorkspace();
  const [values, setValues] = useState<ModeInput>(() => mode
    ? { name: mode.name, description: mode.description, symbol: mode.symbol }
    : { name: "", description: "", symbol: "🧠" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (mode) await updateMistakeMode(userId, mode.id, values);
      else await createMistakeMode(userId, values, maxOrder + 10);
      await onChanged();
      onClose();
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!mode || busy) return;
    if (!window.confirm(`Remove “${mode.name}”? Your mistake records and previous practice answers will be kept, and can be found under Other mistakes or Complete history.`)) return;
    setBusy(true); setError("");
    try {
      await deleteMistakeMode(userId, mode);
      await onChanged();
      onClose();
    } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function move(direction: -1 | 1) {
    if (busy) return;
    setBusy(true); setError("");
    try { await onMove(direction); } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <div className="ws-dialog ml-mode-dialog" role="dialog" aria-modal="true" aria-labelledby="ml-mode-dialog-title"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
      }}>
      <div className="ws-dialog-head">
        <h2 id="ml-mode-dialog-title">{mode ? "Edit mode" : "New practice mode"}</h2>
        <button type="button" className="ws-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17}/></button>
      </div>
      <div className="ml-mode-editor">
        <label className="ws-field"><span>Name</span><input autoFocus maxLength={80} value={values.name}
          placeholder="e.g. Pronunciation" onChange={(event) => setValues({ ...values, name: event.target.value })}/></label>
        <label className="ws-field"><span>Short description</span><input maxLength={220} value={values.description}
          placeholder="What you want to practise here" onChange={(event) => setValues({ ...values, description: event.target.value })}/></label>
        <label className="ws-field"><span>Icon or emoji</span><input maxLength={60} value={values.symbol.startsWith("icon:") ? "" : values.symbol}
          placeholder="Paste or type an emoji" onChange={(event) => setValues({ ...values, symbol: event.target.value })}/></label>
        <div className="ml-symbol-picker" role="group" aria-label="Choose icon or emoji">
          {ICON_CHOICES.map((symbol) => <button type="button" key={symbol} aria-pressed={values.symbol === symbol}
            className={values.symbol === symbol ? "is-active" : ""} title={symbol.replace("icon:", "")}
            onClick={() => setValues({ ...values, symbol })}><ModeSymbol symbol={symbol}/></button>)}
        </div>
        <p className="ml-mode-editor-hint">Choose a symbol above, or paste any emoji in the field. It will appear on this mode’s card.</p>
        {mode ? <div className="ml-mode-management">
          <span>Card order</span>
          <button type="button" className="ws-button is-small" disabled={busy || position <= 0} onClick={() => void move(-1)}><ArrowUp size={14}/> Earlier</button>
          <button type="button" className="ws-button is-small" disabled={busy || position >= total - 1} onClick={() => void move(1)}><ArrowDown size={14}/> Later</button>
          <button type="button" className="ws-button is-small ml-remove-mode" disabled={busy} onClick={() => void remove()}><Trash2 size={14}/> Remove</button>
        </div> : null}
        {error ? <p role="alert" className="ws-field-error">{error}</p> : null}
      </div>
      <div className="ws-dialog-actions">
        <button className="ws-button" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="ws-button is-primary" type="button" disabled={busy || !values.name.trim() || !values.symbol.trim()}
          onClick={() => void save()}>{busy ? "Saving…" : mode ? "Save changes" : <><Plus size={14}/> Create mode</>}</button>
      </div>
    </div>
  </div></Portal>;
}
