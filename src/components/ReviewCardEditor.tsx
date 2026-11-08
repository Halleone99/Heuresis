import { Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fieldText, getCard, updateCard, type CardWithStats, type PackWithType } from "../lib/heuresis";

type Props = {
  pack: PackWithType;
  card: CardWithStats;
  onClose: () => void;
  onSaved: (card: CardWithStats) => void;
};

/** A lightweight edit while reviewing; saving never submits a review grade. */
export default function ReviewCardEditor({ pack, card, onClose, onSaved }: Props) {
  const schema = pack.cardType?.field_schema ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.map((field) => [field.key, fieldText(card.data, field.key)])));
  const [note, setNote] = useState(card.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      // A review result can update card metadata while this window stays open.
      // Refresh the version stamp without overwriting a genuine content edit elsewhere.
      const latest = await getCard(card.id).catch(() => null);
      if (latest && (
        schema.some((field) => fieldText(latest.data, field.key) !== fieldText(card.data, field.key)) ||
        (latest.note ?? "") !== (card.note ?? "")
      )) throw new Error("This card was edited elsewhere. Close and reopen Modify to see the latest version.");
      const source = latest ?? card;
      await updateCard(pack, card.id, values, {
        note,
        favourite: source.favourite,
        interest_rank: source.interest_rank,
        expectedUpdatedAt: source.updated_at,
      });
      // Refresh the actual database row so the running review displays edited content.
      // If reading back is unavailable, the successful save is still reflected locally.
      const refreshed = await getCard(card.id).catch(() => null);
      const nextData = { ...card.data };
      for (const field of schema) {
        const value = (values[field.key] ?? "").trim();
        if (value) nextData[field.key] = value;
        else delete nextData[field.key];
      }
      onSaved(refreshed ?? {
        ...card,
        data: nextData,
        note: note.trim() || null,
        updated_at: new Date().toISOString(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this card.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="cosmos-edit-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialogRef} className="cosmos-edit-dialog" role="dialog" aria-modal="true" aria-label="Modify card"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onClose(); }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); }
      }}>
      <header className="cosmos-edit-head">
        <div><span>CARD</span><h2>Modify card</h2></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close card editor"><X size={18} /></button>
      </header>
      <div className="cosmos-edit-fields">
        {schema.map((field) => <label key={field.key} className="cosmos-edit-field">
          <span>{field.label}{field.required ? " *" : ""}</span>
          {field.role === "example" || field.role === "extra" || field.role === "example_translation"
            ? <textarea rows={3} value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
            : <input type="text" value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}
        </label>)}
        <label className="cosmos-edit-field">
          <span>Note</span>
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {error ? <p className="cosmos-edit-error" role="alert">{error}</p> : null}
      <footer className="cosmos-edit-foot">
        <span><Pencil size={12} aria-hidden="true" /> Editing will not grade this card.</span>
        <div><button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="cosmos-edit-save" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}</button></div>
      </footer>
    </section>
  </div>;
}
