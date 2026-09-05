import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Maximize2, Minimize2, Plus, Trash2, X } from "lucide-react";
import {
  createCard,
  listTags,
  patchCardData,
  type Collection,
  type FieldDef,
  type HeuresisTag,
  type PackWithType,
} from "../lib/heuresis";
import { addRelatedWord, type RelationType } from "../lib/related";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  initialPack: PackWithType | null;
  onBack: () => void;
  onSaved?: () => void;
};

type KnowledgeDimension = "components" | "examples" | "structure" | "origin" | "facts" | "notes";
type BlockKind = "example" | "grammar" | "parts" | "origin" | "fact" | "note" | RelationType;

type CaptureBlock = {
  id: string;
  kind: BlockKind;
  value: string;
  reading?: string;
  meaning?: string;
};

type CaptureDraft = {
  id: string;
  packId: string;
  values: Record<string, string>;
  tagIds: string[];
  blocks: CaptureBlock[];
  createdAt: string;
};

type BlockDef = {
  id: BlockKind;
  label: string;
  dimension?: KnowledgeDimension;
  relation?: RelationType;
  hint: string;
};

const CAPTURE_STORAGE_PREFIX = "heuresis.capture.v1";
const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";

const BLOCKS: BlockDef[] = [
  { id: "example", label: "Example", dimension: "examples", hint: "A useful sentence or context" },
  { id: "grammar", label: "Grammar", dimension: "structure", hint: "Pattern, usage or construction" },
  { id: "related", label: "Related", relation: "related", hint: "Related word or expression" },
  { id: "synonym", label: "Synonym", relation: "synonym", hint: "Synonym" },
  { id: "antonym", label: "Antonym", relation: "antonym", hint: "Antonym" },
  { id: "parts", label: "Parts", dimension: "components", hint: "Characters, roots or components" },
  { id: "origin", label: "Origin", dimension: "origin", hint: "Origin or etymology" },
  { id: "fact", label: "Fact", dimension: "facts", hint: "Something useful or memorable" },
  { id: "note", label: "Note", dimension: "notes", hint: "Your own note" },
];

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);
}

function emptyDraft(packId: string): CaptureDraft {
  return { id: uid(), packId, values: {}, tagIds: [], blocks: [], createdAt: new Date().toISOString() };
}

function blockDef(kind: BlockKind) {
  return BLOCKS.find((item) => item.id === kind)!;
}

function isBlank(draft: CaptureDraft) {
  return !Object.values(draft.values).some((value) => value.trim())
    && !draft.blocks.some((block) => block.value.trim() || block.reading?.trim() || block.meaning?.trim())
    && draft.tagIds.length === 0;
}

function draftIsValid(pack: PackWithType | null, draft: CaptureDraft) {
  if (!pack || pack.id !== draft.packId) return false;
  const fields = pack.cardType?.field_schema ?? [];
  if (!fields.length) return false;
  if (fields.some((field) => field.required && !draft.values[field.key]?.trim())) return false;
  return draft.blocks.every((block) => {
    const def = blockDef(block.kind);
    if (!def.relation) return true;
    if (!block.value.trim() && !block.reading?.trim() && !block.meaning?.trim()) return true;
    return Boolean(block.value.trim() && block.meaning?.trim());
  });
}

function coreFieldGroups(fields: FieldDef[]) {
  if (!fields.length) return { prompt: [] as FieldDef[], answer: [] as FieldDef[], extras: [] as FieldDef[] };
  const termFields = fields.filter((field) => field.role === "term");
  const prompt = termFields.length ? termFields : [fields[0]];
  const promptKeys = new Set(prompt.map((field) => field.key));
  let answer = fields.filter((field) => !promptKeys.has(field.key) && (field.role === "reading" || field.role === "meaning" || field.required));
  if (!answer.length) {
    const fallback = fields.find((field) => !promptKeys.has(field.key));
    if (fallback) answer = [fallback];
  }
  const coreKeys = new Set([...prompt, ...answer].map((field) => field.key));
  return { prompt, answer, extras: fields.filter((field) => !coreKeys.has(field.key)) };
}

function storageKey(packId: string) {
  return `${CAPTURE_STORAGE_PREFIX}:${packId}`;
}

function loadStored(packId: string): { draft: CaptureDraft; queue: CaptureDraft[] } {
  if (!packId) return { draft: emptyDraft(packId), queue: [] };
  try {
    const raw = localStorage.getItem(storageKey(packId));
    if (!raw) return { draft: emptyDraft(packId), queue: [] };
    const parsed = JSON.parse(raw) as { draft?: CaptureDraft; queue?: CaptureDraft[] };
    const draft = parsed.draft?.packId === packId ? parsed.draft : emptyDraft(packId);
    const queue = Array.isArray(parsed.queue) ? parsed.queue.filter((item) => item?.packId === packId) : [];
    return { draft, queue };
  } catch {
    return { draft: emptyDraft(packId), queue: [] };
  }
}

function draftSummary(pack: PackWithType | null, draft: CaptureDraft) {
  const groups = coreFieldGroups(pack?.cardType?.field_schema ?? []);
  const front = groups.prompt.map((field) => draft.values[field.key]?.trim()).filter(Boolean).join(" · ") || "Untitled";
  const back = groups.answer.map((field) => draft.values[field.key]?.trim()).filter(Boolean).join(" · ");
  return { front, back };
}

function FieldSlot({
  field,
  value,
  display,
  inputRef,
  onChange,
  onEnter,
}: {
  field: FieldDef;
  value: string;
  display?: boolean;
  inputRef?: (element: HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
  onEnter?: () => void;
}) {
  return <label className={`capture-slot ${display ? "capture-slot-display" : ""}`}>
    <span>{field.label}{field.required ? <b> *</b> : null}</span>
    <textarea
      ref={inputRef}
      rows={1}
      value={value}
      placeholder={display ? field.label : ""}
      onChange={(event) => {
        onChange(event.target.value);
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && onEnter) {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  </label>;
}

function EnrichmentBlock({ block, onChange, onRemove }: {
  block: CaptureBlock;
  onChange: (block: CaptureBlock) => void;
  onRemove: () => void;
}) {
  const def = blockDef(block.kind);
  return <div className="capture-enrichment-block">
    <div className="capture-enrichment-head">
      <span>{def.label}</span>
      {def.relation ? <em>linked vocabulary</em> : null}
      <button type="button" onClick={onRemove} aria-label={`Remove ${def.label}`}><X size={12} /></button>
    </div>
    <textarea
      rows={1}
      autoFocus
      value={block.value}
      placeholder={def.hint}
      onChange={(event) => onChange({ ...block, value: event.target.value })}
    />
    {def.relation ? <div className="capture-relation-fields">
      <input value={block.reading ?? ""} placeholder="reading / pinyin (optional)" onChange={(event) => onChange({ ...block, reading: event.target.value })} />
      <input value={block.meaning ?? ""} placeholder="meaning" onChange={(event) => onChange({ ...block, meaning: event.target.value })} />
    </div> : null}
  </div>;
}

export default function CaptureView({ collections, packs, initialPack, onBack, onSaved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collectionId, setCollectionId] = useState(initialPack?.collection_id ?? collections[0]?.id ?? "");
  const availablePacks = useMemo(() => packs.filter((pack) => pack.collection_id === collectionId), [collectionId, packs]);
  const [packId, setPackId] = useState(initialPack?.id ?? availablePacks[0]?.id ?? "");
  const pack = packs.find((item) => item.id === packId) ?? null;
  const [draft, setDraft] = useState<CaptureDraft>(() => emptyDraft(packId));
  const [queue, setQueue] = useState<CaptureDraft[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const hydratingRef = useRef(false);

  const fields = pack?.cardType?.field_schema ?? [];
  const groups = useMemo(() => coreFieldGroups(fields), [fields]);
  const coreFields = useMemo(() => [...groups.prompt, ...groups.answer], [groups]);
  const valid = draftIsValid(pack, draft);
  const liveBlank = isBlank(draft);
  const validQueued = queue.filter((item) => draftIsValid(pack, item));
  const commitCount = validQueued.length + (valid && !liveBlank ? 1 : 0);
  const sessionLocked = queue.length > 0 || editingId !== null;

  useEffect(() => { void listTags().then(setTags).catch(() => setTags([])); }, []);

  useEffect(() => {
    if (initialPack && !sessionLocked) {
      setCollectionId(initialPack.collection_id);
      setPackId(initialPack.id);
    }
  }, [initialPack, sessionLocked]);

  useEffect(() => {
    if (!availablePacks.some((item) => item.id === packId) && !sessionLocked) {
      setPackId(availablePacks[0]?.id ?? "");
    }
  }, [availablePacks, packId, sessionLocked]);

  useEffect(() => {
    hydratingRef.current = true;
    const stored = loadStored(packId);
    setDraft(stored.draft);
    setQueue(stored.queue);
    setEditingId(null);
    setStatus(stored.queue.length ? `${stored.queue.length} waiting` : "");
    queueMicrotask(() => { hydratingRef.current = false; });
  }, [packId]);

  useEffect(() => {
    if (!packId || hydratingRef.current) return;
    try {
      if (!queue.length && isBlank(draft)) localStorage.removeItem(storageKey(packId));
      else localStorage.setItem(storageKey(packId), JSON.stringify({ draft, queue }));
    } catch {
      // Capture still works without local persistence.
    }
  }, [packId, draft, queue]);

  const setField = useCallback((key: string, value: string) => {
    setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }));
    setStatus("");
  }, []);

  const addBlock = useCallback((kind: BlockKind) => {
    setDraft((current) => ({ ...current, blocks: [...current.blocks, { id: uid(), kind, value: "", reading: "", meaning: "" }] }));
    setMoreOpen(false);
  }, []);

  const parkDraft = useCallback(() => {
    if (!pack || !draftIsValid(pack, draft)) return;
    setQueue((current) => [...current.filter((item) => item.id !== draft.id), draft]);
    setDraft(emptyDraft(pack.id));
    setEditingId(null);
    setStatus("Ready for another card");
    requestAnimationFrame(() => inputRefs.current[0]?.focus());
  }, [draft, pack]);

  function loadQueued(item: CaptureDraft) {
    setQueue((current) => {
      const withoutItem = current.filter((entry) => entry.id !== item.id);
      return isBlank(draft) ? withoutItem : [...withoutItem, draft];
    });
    setDraft(item);
    setEditingId(item.id);
    setStatus("Editing waiting card");
    requestAnimationFrame(() => inputRefs.current[0]?.focus());
  }

  function removeQueued(id: string) {
    setQueue((current) => current.filter((item) => item.id !== id));
    setStatus("");
  }

  async function enrichCreatedCard(cardId: string, item: CaptureDraft) {
    const workspace = item.blocks.flatMap((block) => {
      const def = blockDef(block.kind);
      if (!def.dimension || !block.value.trim()) return [];
      return [JSON.stringify({ id: uid(), type: "text", text: block.value.trim(), dim: def.dimension })];
    });
    if (workspace.length) await patchCardData(cardId, { [WORKSPACE_BLOCKS_KEY]: workspace });

    for (const block of item.blocks) {
      const def = blockDef(block.kind);
      if (!def.relation || !block.value.trim()) continue;
      await addRelatedWord({
        sourceCardId: cardId,
        term: block.value,
        reading: block.reading,
        meaning: block.meaning,
        relationType: def.relation,
      });
    }
  }

  async function commit() {
    if (!pack || saving) return;
    const targets = [...validQueued, ...(valid && !liveBlank ? [draft] : [])];
    if (!targets.length) return;
    setSaving(true); setStatus("");
    const createdIds = new Set<string>();
    const failedIds = new Set<string>();
    const warnings: string[] = [];

    for (const item of targets) {
      try {
        const created = await createCard(pack, item.values, undefined, item.tagIds);
        createdIds.add(item.id);
        try {
          await enrichCreatedCard(created.id, item);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Some enrichment could not be saved.");
        }
      } catch (error) {
        failedIds.add(item.id);
        warnings.push(error instanceof Error ? error.message : "A card could not be created.");
      }
    }

    setQueue((current) => current.filter((item) => !createdIds.has(item.id)));
    if (createdIds.has(draft.id)) {
      setDraft(emptyDraft(pack.id));
      setEditingId(null);
    }
    if (createdIds.size) onSaved?.();

    if (failedIds.size) setStatus(`${createdIds.size} added · ${failedIds.size} still waiting`);
    else if (warnings.length) setStatus(`${createdIds.size} added · check enrichment warning`);
    else setStatus(`${createdIds.size} ${createdIds.size === 1 ? "card" : "cards"} added to Heuresis`);
    if (warnings.length) console.warn("Capture commit warnings", warnings);
    setSaving(false);
    requestAnimationFrame(() => inputRefs.current[0]?.focus());
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (moreOpen) setMoreOpen(false);
        else onBack();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        parkDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, onBack, parkDraft]);

  const collection = collections.find((item) => item.id === collectionId) ?? null;

  return <div className="capture-popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onBack(); }}>
    <section className={`capture-composer ${expanded ? "expanded" : "compact"}`} role="dialog" aria-modal="true" aria-label="Capture Heuresis cards">
      <header className="capture-composer-head">
        <div className="capture-context-pickers">
          <select
            value={collectionId}
            disabled={sessionLocked}
            aria-label="Collection"
            onChange={(event) => {
              const nextCollection = event.target.value;
              setCollectionId(nextCollection);
              setPackId(packs.find((item) => item.collection_id === nextCollection)?.id ?? "");
            }}
          >{collections.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <span>/</span>
          <select value={packId} disabled={sessionLocked} aria-label="Topic" onChange={(event) => setPackId(event.target.value)}>
            {availablePacks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {pack?.cardType ? <span className="capture-schema-badge">{pack.cardType.name}</span> : null}
        </div>
        <div className="capture-window-actions">
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Shrink Capture" : "Expand Capture"} title={expanded ? "Shrink" : "Expand"}>
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" onClick={onBack} aria-label="Close Capture"><X size={16} /></button>
        </div>
      </header>

      <div className="capture-composer-main">
        <div className="capture-editor-scroll">
          {!pack ? <div className="capture-empty">Choose a topic before capturing a card.</div> : null}
          {pack && !fields.length ? <div className="capture-empty">This topic has no readable card schema yet.</div> : null}

          {pack && fields.length ? <>
            <div className="capture-card-surface">
              <div className="capture-side-label"><span>RECTO</span><em>prompt</em></div>
              {groups.prompt.map((field, index) => <FieldSlot
                key={field.key}
                field={field}
                display
                value={draft.values[field.key] ?? ""}
                inputRef={(element) => { inputRefs.current[index] = element; }}
                onChange={(value) => setField(field.key, value)}
                onEnter={() => inputRefs.current[index + 1]?.focus()}
              />)}

              <div className="capture-card-divider"><span>VERSO</span></div>

              {groups.answer.map((field, answerIndex) => {
                const index = groups.prompt.length + answerIndex;
                const isLast = index === coreFields.length - 1;
                return <FieldSlot
                  key={field.key}
                  field={field}
                  value={draft.values[field.key] ?? ""}
                  inputRef={(element) => { inputRefs.current[index] = element; }}
                  onChange={(value) => setField(field.key, value)}
                  onEnter={() => isLast ? parkDraft() : inputRefs.current[index + 1]?.focus()}
                />;
              })}

              {expanded && groups.extras.length ? <div className="capture-extra-fields">
                <div className="capture-side-label"><span>ADDITIONAL FIELDS</span><em>schema</em></div>
                {groups.extras.map((field) => <FieldSlot key={field.key} field={field} value={draft.values[field.key] ?? ""} onChange={(value) => setField(field.key, value)} />)}
              </div> : null}

              {draft.blocks.map((block) => <EnrichmentBlock
                key={block.id}
                block={block}
                onChange={(next) => setDraft((current) => ({ ...current, blocks: current.blocks.map((item) => item.id === block.id ? next : item) }))}
                onRemove={() => setDraft((current) => ({ ...current, blocks: current.blocks.filter((item) => item.id !== block.id) }))}
              />)}
            </div>

            <div className="capture-enrichment-palette">
              {(expanded || moreOpen ? BLOCKS : BLOCKS.slice(0, 3)).map((item) => <button type="button" key={item.id} onClick={() => addBlock(item.id)}>+ {item.label}</button>)}
              {!expanded && !moreOpen ? <button type="button" onClick={() => setMoreOpen(true)}>more…</button> : null}
            </div>

            {expanded && tags.length ? <div className="capture-tag-panel">
              <span>TAGS</span>
              <div>{tags.map((tag) => {
                const selected = draft.tagIds.includes(tag.id);
                return <button type="button" key={tag.id} className={selected ? "selected" : ""} onClick={() => setDraft((current) => ({
                  ...current,
                  tagIds: selected ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id],
                }))}>{tag.name}</button>;
              })}</div>
            </div> : null}
          </> : null}
        </div>

        {expanded ? <aside className="capture-queue-panel">
          <div className="capture-queue-title"><span>WAITING</span><strong>{queue.length}</strong></div>
          {!queue.length ? <p>Nothing waiting. Use <b>Add another</b> to park a card and continue capturing.</p> : null}
          {queue.map((item) => {
            const summary = draftSummary(pack, item);
            const itemValid = draftIsValid(pack, item);
            return <button type="button" className={`capture-queue-item ${editingId === item.id ? "active" : ""}`} key={item.id} onClick={() => loadQueued(item)}>
              <span><strong>{summary.front}</strong><em>{summary.back}</em>{item.blocks.length ? <small>{item.blocks.map((block) => blockDef(block.kind).label).join(" · ")}</small> : null}{!itemValid ? <small className="capture-invalid">needs attention</small> : null}</span>
              <i onClick={(event) => { event.stopPropagation(); removeQueued(item.id); }}><Trash2 size={12} /></i>
            </button>;
          })}
        </aside> : null}
      </div>

      {!expanded && queue.length ? <div className="capture-waiting-strip">
        <button type="button" onClick={() => setQueueOpen((value) => !value)}><Layers size={13} /> {queue.length} waiting <ChevronDown size={13} className={queueOpen ? "open" : ""} /></button>
        {queueOpen ? <div>{queue.map((item) => {
          const summary = draftSummary(pack, item);
          return <button type="button" key={item.id} onClick={() => loadQueued(item)}><strong>{summary.front}</strong><span>{summary.back}</span><i onClick={(event) => { event.stopPropagation(); removeQueued(item.id); }}><Trash2 size={11} /></i></button>;
        })}</div> : null}
      </div> : null}

      <footer className="capture-composer-foot">
        <div className="capture-foot-copy">
          {status ? <span className={status.includes("added") ? "success" : ""}>{status}</span> : <span>{collection?.title ?? "Heuresis"} · Enter next field · Ctrl+Enter add another</span>}
          {sessionLocked ? <small>Destination stays fixed while cards are waiting.</small> : null}
        </div>
        <div className="capture-foot-actions">
          <button type="button" className="capture-secondary" disabled={!valid || saving} onClick={parkDraft}><Plus size={14} /> Add another</button>
          <button type="button" className="capture-commit" disabled={!commitCount || saving} onClick={() => void commit()}><Check size={15} /> {saving ? "Adding…" : commitCount > 1 ? `Add ${commitCount} to Heuresis` : "Add to Heuresis"}</button>
        </div>
      </footer>
    </section>
  </div>;
}
