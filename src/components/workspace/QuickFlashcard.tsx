import { useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";
import { createCard, listCollections, listPacks, type Collection, type PackWithType } from "../../lib/heuresis";
import { chooseFlashcardDestination } from "../../lib/languages";
import { friendlyError } from "../../lib/knowledgeWorkspace";
import { AICheck } from "./AICheck";

type Draft = { front: string; back: string; packId: string };
const empty: Draft = { front: "", back: "", packId: "" };
const keyFor = (userId: string) => `heuresis.quick.flashcard.v1:${userId}`;

export function QuickFlashcard({ userId, subjectName, onSaved }: { userId: string; subjectName: string; onSaved: (label: string) => void }) {
  const [draft, setDraft] = useState<Draft>(() => {
    try { return { ...empty, ...JSON.parse(localStorage.getItem(keyFor(userId)) || "{}") }; }
    catch { return empty; }
  });
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    try { localStorage.setItem(keyFor(userId), JSON.stringify(draft)); } catch { /* optional cache */ }
  }, [draft, userId]);
  useEffect(() => {
    let active = true;
    Promise.all([listPacks(), listCollections()]).then(([p, c]) => {
      if (!active) return;
      setPacks(p); setCollections(c);
      setDraft((current) => {
        if (p.some((pack) => pack.id === current.packId)) return current;
        const recommended = chooseFlashcardDestination({ subjectName, packs: p, collections: c, rememberedPackId: "", text: current.front });
        return { ...current, packId: recommended.pack?.id ?? "" };
      });
    }).catch((reason) => active && setError(friendlyError(reason)))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [subjectName]);
  const pack = packs.find((item) => item.id === draft.packId) ?? null;
  const fields = pack?.cardType?.field_schema ?? [];
  const frontField = fields.find((field) => field.role === "term") ?? fields[0];
  const backField = fields.find((field) => field.role === "meaning") ?? fields.find((field) => field.key !== frontField?.key);
  const unsupported = Boolean(pack && (!frontField || !backField));

  async function save() {
    if (!pack || !frontField || !backField || !draft.front.trim() || !draft.back.trim() || busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      await createCard(pack, { [frontField.key]: draft.front.trim(), [backField.key]: draft.back.trim() }, "Quick Capture");
      setDraft((current) => ({ ...current, front: "", back: "" }));
      window.dispatchEvent(new CustomEvent("heuresis:study-changed"));
      setSaved("Flashcard saved to Study.");
      onSaved(draft.front.trim());
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  const currentCollection = useMemo(() => collections.find((col) => col.id === pack?.collection_id), [collections, pack]);
  return <div className="qc-flashcard">
    <label className="qc-field"><span>Study topic</span>
      <select value={draft.packId} disabled={loading || busy} onChange={(e) => { setDraft((d) => ({ ...d, packId: e.target.value })); setSaved(""); }}>
        <option value="">Choose a Study topic…</option>
        {collections.map((collection) => <optgroup key={collection.id} label={collection.title}>
          {packs.filter((item) => item.collection_id === collection.id).map((item) =>
            <option key={item.id} value={item.id}>{item.title}</option>)}
        </optgroup>)}
      </select>
    </label>
    {currentCollection ? <small className="qc-flashcard-context">Saving to {currentCollection.title} → {pack?.title}</small> : null}
    <label className="qc-field"><span>Front</span>
      <textarea rows={2} value={draft.front} onChange={(e) => { setDraft((d) => ({ ...d, front: e.target.value })); setSaved(""); }}
        placeholder="Word, phrase or question…" disabled={busy}/>
    </label>
    <label className="qc-field"><span>Back</span>
      <textarea rows={2} value={draft.back} onChange={(e) => { setDraft((d) => ({ ...d, back: e.target.value })); setSaved(""); }}
        placeholder="Meaning or answer…" disabled={busy}/>
    </label>
    <AICheck text={draft.back} language={subjectName} onApply={(next) => setDraft((d) => ({ ...d, back: next }))} compact/>
    {unsupported ? <p className="qc-ai-error">This Study topic needs more than a front and back. Use Study to make this card.</p> : null}
    {!loading && packs.length === 0 ? <p className="qc-ai-error">Create a Study topic first. This draft will be kept.</p> : null}
    {error ? <p className="qc-ai-error" role="alert">{error}</p> : null}
    {saved ? <p className="qc-flash" role="status">{saved}</p> : null}
    <div className="qc-flashcard-foot"><button type="button" className="ws-button is-primary"
      disabled={!pack || unsupported || busy || !draft.front.trim() || !draft.back.trim()} onClick={() => void save()}>
      <Layers size={14}/> {busy ? "Saving…" : "Save flashcard"}
    </button></div>
  </div>;
}
