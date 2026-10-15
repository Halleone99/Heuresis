import { useEffect, useMemo, useRef, useState } from "react";
import { Layers, X } from "lucide-react";
import { createCard, listCollections, listPacks, type Collection, type PackWithType } from "../../lib/heuresis";
import { entryTitle, friendlyError, plainLine, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { inlinePlain } from "../../lib/noteFormat";
import { chooseFlashcardDestination, languageFromCollection, languageName, type LanguageKey } from "../../lib/languages";
import { Portal } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const LAST_PACK_KEY = "heuresis.flashcard.lastPack.v1";

/** Suggest card fields from a note or a corrected mistake; the user edits before saving. */
function suggestedValues(entry: KnowledgeEntry, pack: PackWithType | null) {
  const schema = pack?.cardType?.field_schema ?? [];
  const byRole = (role: string) => schema.find((field) => field.role === role)?.key;
  const values: Record<string, string> = {};
  if (entry.kind === "mistake") {
    const term = byRole("term"); const meaning = byRole("meaning"); const extra = byRole("extra");
    if (term) values[term] = entry.correction;
    if (meaning && entry.explanation) values[meaning] = entry.explanation;
    else if (extra && entry.explanation) values[extra] = entry.explanation;
    return values;
  }
  // Only fill what the note states unambiguously: its title (or first line) and,
  // for the common quick-capture shape "下课以后 — after class", the meaning.
  const lines = entry.body.split(/\r?\n/).map((line) => inlinePlain(plainLine(line))).filter(Boolean);
  const term = byRole("term"); const meaning = byRole("meaning");
  const title = entry.title.trim();
  const pair = !title ? lines[0]?.match(/^(.+?)\s+(?:—|–|-|=|:)\s+(.+)$/) : null;
  if (term) values[term] = pair ? pair[1].trim() : title || lines[0] || "";
  if (meaning && pair) values[meaning] = pair[2].trim();
  return values;
}

export function FlashcardDialog({ entry, onClose }: { entry: KnowledgeEntry; onClose: () => void }) {
  const workspace = useWorkspace();
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packId, setPackId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const subjectName = workspace.topicPath(entry.topic_id).subject?.name ?? "";
  const [noteLanguage, setNoteLanguage] = useState<LanguageKey | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Take focus so Escape, Tab and Ctrl+Enter act on this dialog straight away.
  useEffect(() => { formRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let alive = true;
    void Promise.all([listPacks(), listCollections()]).then(([nextPacks, nextCollections]) => {
      if (!alive) return;
      setPacks(nextPacks); setCollections(nextCollections);
      let remembered = "";
      try { remembered = localStorage.getItem(LAST_PACK_KEY) ?? ""; } catch { /* optional */ }
      // Keep a note in its own language. The last-used topic is reused only when it
      // is in that language; with no same-language collection, the user chooses.
      const choice = chooseFlashcardDestination({
        subjectName, packs: nextPacks, collections: nextCollections, rememberedPackId: remembered,
        text: [entry.title, entry.body, entry.attempt, entry.correction].join(" "),
      });
      setNoteLanguage(choice.language);
      if (choice.pack) { setPackId(choice.pack.id); setValues(suggestedValues(entry, choice.pack)); }
    }).catch((loadError) => { if (alive) setError(friendlyError(loadError)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // Load once per entry; later edits to the suggested values belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const pack = packs.find((item) => item.id === packId) ?? null;
  const packCollection = pack ? collections.find((collection) => collection.id === pack.collection_id) ?? null : null;
  const packLanguage = packCollection ? languageFromCollection(packCollection) : null;
  const languageMismatch = Boolean(noteLanguage && packLanguage && noteLanguage !== packLanguage);
  const grouped = useMemo(() => collections.map((collection) => ({ collection, packs: packs.filter((item) => item.collection_id === collection.id) }))
    .filter((group) => group.packs.length), [collections, packs]);

  async function save() {
    if (!pack || saving) return;
    setSaving(true); setError("");
    try {
      await createCard(pack, values, `From Notebook: ${entryTitle(entry)}`);
      try { localStorage.setItem(LAST_PACK_KEY, pack.id); } catch { /* optional */ }
      window.dispatchEvent(new CustomEvent("heuresis:study-changed"));
      workspace.toast(`Card added to ${pack.title}.`);
      onClose();
    } catch (saveError) { setError(friendlyError(saveError)); }
    finally { setSaving(false); }
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form ref={formRef} tabIndex={-1} className="ws-dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="fc-title"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
      }}>
      <div className="ws-dialog-head">
        <h2 id="fc-title"><Layers size={17} /> Make a flashcard</h2>
        <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      <p className="ws-muted">Create a Study card from this note. The original note stays unchanged.</p>
      {loading ? <div className="ws-loading"><span className="ws-spinner" /> Loading Study topics…</div> : !packs.length
        ? <p className="ws-field-error">There are no Study topics yet. Create one in Study first.</p>
        : <>
          <label className="ws-field">Study topic
            <select value={packId} required onChange={(event) => {
              const next = packs.find((item) => item.id === event.target.value) ?? null;
              setPackId(event.target.value);
              setValues(suggestedValues(entry, next));
            }}>
              {!packId ? <option value="" disabled>Choose a Study topic…</option> : null}
              {grouped.map((group) => <optgroup key={group.collection.id} label={group.collection.title}>
                {group.packs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </optgroup>)}
            </select>
          </label>
          {!packId && noteLanguage ? <p className="ws-field-hint" role="status">No Study collection is in {languageName(noteLanguage)} yet. Choose a topic deliberately, or create a {languageName(noteLanguage)} collection in Study first.</p> : null}
          {!packId && !noteLanguage ? <p className="ws-field-hint" role="status">Choose the Study topic for this card.</p> : null}
          {languageMismatch ? <p className="ws-field-error" role="alert">This note is {languageName(noteLanguage)}, but “{pack?.title}” is in a {languageName(packLanguage)} collection.</p> : null}
          <div className="ws-field-grid">
            {(pack?.cardType?.field_schema ?? []).map((field) => <label key={field.key} className="ws-field">
              <span>{field.label}{field.required ? <b aria-hidden="true"> *</b> : null}</span>
              <input value={values[field.key] ?? ""} required={field.required}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
            </label>)}
          </div>
        </>}
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      <div className="ws-dialog-actions">
        <button type="button" className="ws-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="ws-button is-primary" disabled={!pack || saving}>{saving ? "Adding…" : "Add card"}</button>
      </div>
    </form>
  </div></Portal>;
}
