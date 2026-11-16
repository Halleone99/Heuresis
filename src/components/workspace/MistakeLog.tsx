import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, GraduationCap, Play, Plus, Search, Trash2, X } from "lucide-react";
import { comparableCorrection, friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { Kbd, MOD_KEY, Portal, TopicPicker, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText } from "./RichText";
import { mistakeDifference, type DifferencePart } from "../../lib/mistakeDiff";
import { parseCaptureLine } from "../../lib/captureParse";
import { createReviewRoute, openCosmosWindow } from "../../lib/cosmosWindow";
import { useStudyMistakes, type StudyMistake } from "./useStudyMistakes";
import "./mistake-cards.css";

function DiffLine({ parts }: { parts: DifferencePart[] }) {
  return <>{parts.map((part, index) => <span key={index}
    className={part.kind === "wrong" ? "ml-diff-wrong" : part.kind === "corrected" ? "ml-diff-right"
      : part.kind === "gap" ? "ml-diff-gap" : undefined}>{part.text}</span>)}</>;
}

function MistakeDisplay({ parts, chinese }: { parts: DifferencePart[]; chinese: boolean }) {
  if (!chinese) return <DiffLine parts={parts}/>;
  const lines: DifferencePart[][] = [[]];
  for (const part of parts) {
    part.text.split(/\r?\n/u).forEach((text, index) => {
      if (index > 0) lines.push([]);
      if (text) lines[lines.length - 1].push({ ...part, text });
    });
  }
  return <>{lines.map((line, index) => <span key={index}
    className={"ml-display-line" + (line.some((part) => /[\u3400-\u9FFF]/u.test(part.text)) ? " is-han" : " is-pinyin")}>
    <DiffLine parts={line}/>
  </span>)}</>;
}

function ruleParts(title: string) {
  const match = title.trim().match(/^(.+?)\s+[–—-]\s+(.+)$/u);
  return { rule: (match?.[1] ?? title).trim(), detail: match?.[2]?.trim() ?? "" };
}

/** Exact pair, within a subject. Matching only the correction merges unrelated errors. */
function findRepeatedMistake(entries: KnowledgeEntry[], topics: ReturnType<typeof useWorkspace>["topicById"],
  topicId: string, attempt: string, correction: string) {
  const subject = topics.get(topicId)?.subject_id;
  if (!subject) return undefined;
  const wrong = comparableCorrection(attempt), right = comparableCorrection(correction);
  return entries.find((entry) => entry.kind === "mistake"
    && topics.get(entry.topic_id)?.subject_id === subject
    && comparableCorrection(entry.attempt) === wrong
    && comparableCorrection(entry.correction) === right);
}

function isNotFiled(entry: KnowledgeEntry, topicById: ReturnType<typeof useWorkspace>["topicById"],
  subjectById: ReturnType<typeof useWorkspace>["subjectById"]) {
  const topic = topicById.get(entry.topic_id);
  return !topic || topic.name.trim().toLowerCase() === "inbox"
    || subjectById.get(topic.subject_id)?.name.trim().toLowerCase() === "unsorted";
}


type CardStatus = "missed" | "fresh" | "recalled";
type SortKind = "newest" | "most" | "fresh" | "oldest";
type MistakeCardItem = {
  id: string; source: "logged" | "study"; subject: string; subjectKey: string; glyph: string;
  topic: string; topicKey: string; date: string; misses: number; status: CardStatus;
  pinned: boolean; repeated: number; entry?: KnowledgeEntry; study?: StudyMistake;
};
const normalise = (value: string) => value.trim().toLocaleLowerCase();
const SHOW_OPTIONS = [
  { value: "all", label: "Everything" }, { value: "missed", label: "Missed last time" },
  { value: "fresh", label: "Not practised yet" }, { value: "recalled", label: "Recalled" },
];
const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" }, { value: "most", label: "Most missed" },
  { value: "fresh", label: "Not practised first" }, { value: "oldest", label: "Oldest first" },
];

/** A compact keyboard-accessible dropdown; closes on Escape and outside clicks. */
function CardFilter({ label, value, options, onChange }: {
  label: string; value: string; options: Array<{ value: string; label: string; count?: number }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const current = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? "All";
  return <div className="hc-dropdown" ref={ref}>
    <button type="button" className={"hc-filter" + (value !== options[0]?.value ? " is-set" : "")}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      {label}: <strong>{current}</strong><ChevronDown size={13}/>
    </button>
    {open ? <div role="menu" aria-label={label} className="hc-menu" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); ref.current?.querySelector("button")?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
      {options.map((option) => <button type="button" role="menuitemradio" key={option.value}
        aria-checked={value === option.value} onClick={() => { onChange(option.value); setOpen(false); }}>
        <span className="hc-menu-check">{value === option.value ? "✓" : ""}</span>{option.label}
        {option.count !== undefined ? <small>{option.count}</small> : null}
      </button>)}
    </div> : null}
  </div>;
}

function FlippingCard({ item, selecting, selected, highlighted, onSelect, onEdit, onPractise, onReview, onLog }: {
  item: MistakeCardItem; selecting: boolean; selected: boolean; highlighted: boolean;
  onSelect: () => void; onEdit: () => void; onPractise: () => void;
  onReview: () => void; onLog: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const entry = item.entry;
  const card = item.study;
  const idea = Boolean(entry && isIdeaStyle(entry));
  const diff = entry && !idea ? mistakeDifference(entry.attempt, entry.correction) : null;
  const chinese = Boolean(entry && /[\u3400-\u9FFF]/u.test(entry.attempt + entry.correction));
  const rule = entry?.title ? ruleParts(entry.title).rule : "";
  const statusText = item.status === "missed" ? "Missed last time" :
    item.status === "recalled" ? "Recalled" : "Not practised yet";
  const place = item.glyph + " " + item.topic + (rule ? " · " + rule : "");
  const toggle = () => selecting && entry ? onSelect() : setFlipped((value) => !value);
  const press = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  };
  return <article className={"hc-card" + (flipped ? " is-flipped" : "") +
    (card ? " is-study" : "") + (selected ? " is-selected" : "") + (highlighted ? " is-highlighted" : "")}
    role="button" tabIndex={0} aria-pressed={selecting ? selected : flipped}
    aria-label={(selecting ? "Select " : "Flip ") + (entry?.attempt ?? card?.title ?? "mistake")}
    data-mistake={entry?.id} onClick={(event) => {
      if ((event.target as HTMLElement).closest("button, input, a")) return;
      toggle();
    }} onKeyDown={press}>
    <div className="hc-face hc-front">
      <div className="hc-card-top">
        <span className="hc-card-place">{place}</span>
        {entry ? <span className={"hc-status is-" + item.status}>
          <i/>{statusText}{item.repeated ? " · Made again " + item.repeated + "×" : ""}{item.pinned ? " · Pinned" : ""}
        </span> : <span className="hc-status is-study"><Copy size={12}/> Missed {item.misses}× in Review</span>}
      </div>
      <div className={"hc-main" + (idea ? " is-idea" : "")}>
        {entry ? diff ? <MistakeDisplay parts={diff.before} chinese={chinese}/> : entry.attempt || "Not recorded"
          : card?.title}
      </div>
      <span className="hc-hint">{card ? "What does it mean?" : "What's right?"}</span>
      {selecting && entry ? <span aria-hidden="true" className="hc-select-mark">{selected ? "✓" : "○"}</span> : null}
    </div>
    <div className="hc-face hc-back">
      <div className="hc-card-top"><span className="hc-card-place">{place}</span><span className="hc-success">✓</span></div>
      <div className={"hc-main" + (idea ? " is-idea" : "")}>
        {entry ? entry.correction ? diff ? <MistakeDisplay parts={diff.after} chinese={chinese}/> : entry.correction
          : <span className="hc-missing">Add the correct version</span> : card?.reference || "No answer recorded"}
      </div>
      {entry?.explanation ? <RichText text={entry.explanation} className="hc-explanation is-compact"/> : null}
      {card ? <div className="hc-explanation">
        {card.attempt ? <span className="hc-wrong">You wrote {card.attempt}. </span> : null}
        {card.direction}{card.explanation ? " · " + card.explanation : ""}
      </div> : null}
      <div className="hc-card-actions">
        {entry ? <>
          <button type="button" disabled={!entry.correction.trim()} onClick={onPractise}>Practise</button>
          <button type="button" className="is-quiet" onClick={onEdit}>Edit</button>
        </> : <>
          <button type="button" onClick={onReview}>Review this card</button>
          <button type="button" className="is-quiet" onClick={onLog}>Add to my log</button>
        </>}
      </div>
    </div>
  </article>;
}

function AddMistakeTile({ initialTopicId, prefill, onCancel, onSaved }: {
  initialTopicId: string; prefill: { attempt: string; correction: string; explanation: string } | null;
  onCancel: () => void; onSaved: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const [topicId, setTopicId] = useState(initialTopicId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attempt, setAttempt] = useState(prefill?.attempt ?? "");
  const [correction, setCorrection] = useState(prefill?.correction ?? "");
  const [explanation, setExplanation] = useState(prefill?.explanation ?? "");
  const [duplicate, setDuplicate] = useState<KnowledgeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const clear = () => { setAttempt(""); setCorrection(""); setExplanation(""); setDuplicate(null); input.current?.focus(); };
  async function save(forceSeparate = false) {
    if (!attempt.trim() || busy) return;
    if (!topicId || !workspace.topicById.has(topicId)) { setPickerOpen(true); setError("Choose a subject and topic."); return; }
    if (!forceSeparate) {
      const repeated = findRepeatedMistake(workspace.snapshot.entries, workspace.topicById, topicId, attempt, correction);
      if (repeated) { setDuplicate(repeated); return; }
    }
    setBusy(true); setError(""); setDuplicate(null);
    try {
      const saved = await workspace.addEntry({ kind: "mistake", topicId, attempt: attempt.trim(),
        correction: correction.trim(), explanation: explanation.trim() });
      onSaved(saved.id); clear();
    } catch (reason) { setError(friendlyError(reason)); } finally { setBusy(false); }
  }
  async function madeAgain() {
    if (!duplicate || busy) return;
    setBusy(true);
    try { await workspace.recordRepeated(duplicate.id); onSaved(duplicate.id);
      workspace.toast("Recorded as made again."); clear();
    } catch (reason) { setError(friendlyError(reason)); } finally { setBusy(false); }
  }
  return <div className="hc-addform">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !pickerOpen) { event.preventDefault(); onCancel(); } }}>
      <textarea ref={input} rows={2} maxLength={5000} aria-label="What you wrote" placeholder="What you wrote"
        value={attempt} onChange={(event) => { setAttempt(event.target.value); setDuplicate(null); }}/>
      <textarea rows={2} maxLength={5000} aria-label="What's right" placeholder="What's right"
        value={correction} onFocus={() => {
          if (!correction.trim() && attempt.trim().split(/\s+/u).length < 30) setCorrection(attempt.split("\n")[0]);
        }} onChange={(event) => { setCorrection(event.target.value); setDuplicate(null); }}/>
      <textarea rows={2} maxLength={5000} aria-label="Why (optional)" placeholder="Why (optional)"
        value={explanation} onChange={(event) => setExplanation(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); void save(); } }}/>
      <button type="button" className="hc-destination" onClick={() => setPickerOpen(true)}>
        Saved to {topicId ? workspace.pathLabel(topicId) : "Choose a topic"} <ChevronDown size={12}/>
      </button>
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      {duplicate ? <div className="hc-duplicate" role="status">
        You logged this before.
        <button type="button" disabled={busy} onClick={() => void madeAgain()}>Made again</button>
        <button type="button" disabled={busy} onClick={() => void save(true)}>Keep separately</button>
      </div> : null}
      <div className="hc-add-actions"><button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="hc-primary" disabled={busy || !attempt.trim()}>{busy ? "Saving…" : "Add"}</button></div>
    </form>
    {topicId ? <MistakeBulkAdd topicId={topicId}/> : null}
    {pickerOpen ? <Portal><div className="ws-dialog-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
      <TopicPicker value={topicId || null} onClose={() => setPickerOpen(false)}
        onChange={(id) => { setTopicId(id); setError(""); setPickerOpen(false); }}/>
    </div></Portal> : null}
  </div>;
}

export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, focusMistake, clearFocusMistake } = workspace;
  const study = useStudyMistakes();
  const stored = workspace.memory.mistakes;
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(stored.subjectId);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(stored.topicId);
  const [status, setStatus] = useState<CardStatus | "all">(stored.status ?? "all");
  const [sort, setSort] = useState<SortKind>(stored.sort ?? "newest");
  const [showStudy, setShowStudy] = useState(Boolean(stored.study));
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<{ attempt: string; correction: string; explanation: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState(false);
  const [bulkRule, setBulkRule] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmElement, confirm] = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const mistakes = useMemo(() => snapshot.entries.filter((entry) => entry.kind === "mistake"), [snapshot.entries]);
  const practiceStatus = useMemo(() => {
    const map = new Map<string, { last: { outcome: string; created_at: string } | null; repeated: number; missed: number }>();
    for (const event of snapshot.practice) {
      const row = map.get(event.record_id) ?? { last: null, repeated: 0, missed: 0 };
      if (event.source === "repeated") row.repeated++;
      else {
        if (event.outcome === "incorrect") row.missed++;
        if (!row.last || event.created_at > row.last.created_at) row.last = event;
      }
      map.set(event.record_id, row);
    }
    return map;
  }, [snapshot.practice]);
  const allItems = useMemo((): MistakeCardItem[] => {
    const own = mistakes.map((entry): MistakeCardItem => {
      const topic = workspace.topicById.get(entry.topic_id);
      const subject = topic ? workspace.subjectById.get(topic.subject_id) : undefined;
      const name = subject?.name ?? "Unsorted";
      const state = practiceStatus.get(entry.id);
      return { id: "log:" + entry.id, source: "logged", subject: name, subjectKey: normalise(name),
        glyph: name.slice(0, 1), topic: isNotFiled(entry, workspace.topicById, workspace.subjectById)
          ? "Not filed" : topic?.name ?? "Not filed",
        topicKey: isNotFiled(entry, workspace.topicById, workspace.subjectById) ? "__not-filed__" : normalise(topic?.name ?? "Not filed"),
        date: entry.created_at, misses: (state?.missed ?? 0) + (state?.repeated ?? 0),
        status: state?.last?.outcome === "incorrect" ? "missed" : state?.last ? "recalled" : "fresh",
        pinned: Boolean(entry.pinned), repeated: state?.repeated ?? 0, entry };
    });
    const linked = study.items.map((item): MistakeCardItem => ({
      id: "study:" + item.cardId, source: "study", subject: item.subject, subjectKey: normalise(item.subject),
      glyph: item.glyph, topic: item.topic, topicKey: normalise(item.topic),
      date: item.lastWrongAt, misses: item.missCount, status: "missed", pinned: false, repeated: 0, study: item,
    }));
    return [...own, ...linked];
  }, [mistakes, practiceStatus, workspace.topicById, workspace.subjectById, study.items]);
  const base = allItems.filter((item) => item.source === (showStudy ? "study" : "logged"));
  // Previously saved Notebook UUIDs continue to resolve after the chips adopt shared subject-name keys.
  const subjectKey = selectedSubjectId ? normalise(workspace.subjectById.get(selectedSubjectId)?.name ?? selectedSubjectId) : null;
  const topicKey = selectedTopicId ? normalise(workspace.topicById.get(selectedTopicId)?.name ?? selectedTopicId) : null;
  const bySubject = subjectKey ? base.filter((item) => item.subjectKey === subjectKey) : base;
  const subjectMap = new Map<string, { value: string; label: string; glyph: string; count: number }>();
  for (const item of base) {
    const existing = subjectMap.get(item.subjectKey);
    if (existing) { existing.count++; if (item.source === "study") existing.glyph = item.glyph; }
    else subjectMap.set(item.subjectKey, { value: item.subjectKey, label: item.subject, glyph: item.glyph, count: 1 });
  }
  const subjects = [...subjectMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  const topicMap = new Map<string, { value: string; label: string; count: number }>();
  for (const item of bySubject) {
    const found = topicMap.get(item.topicKey);
    if (found) found.count++;
    else topicMap.set(item.topicKey, { value: item.topicKey, label: item.topic, count: 1 });
  }
  const topics = [...topicMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  const searchTerm = normalise(search);
  const filtered = bySubject.filter((item) => {
    if (topicKey && item.topicKey !== topicKey) return false;
    if (!showStudy && status !== "all" && item.status !== status) return false;
    const values = item.entry ? [item.entry.attempt, item.entry.correction, item.entry.explanation, item.entry.title]
      : [item.study?.title, item.study?.reference, item.study?.attempt, item.study?.explanation, item.study?.direction];
    return !searchTerm || [...values, item.topic, item.subject].some((text) => normalise(text ?? "").includes(searchTerm));
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
    (sort === "most" ? b.misses - a.misses : sort === "fresh" ? Number(a.status === "fresh") - Number(b.status === "fresh") :
      sort === "oldest" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) ||
    b.date.localeCompare(a.date));
  const visibleLogged = filtered.filter((item) => item.entry?.correction.trim()).map((item) => item.entry!);
  const activeFilters = Boolean(subjectKey || topicKey || searchTerm || (!showStudy && status !== "all"));
  function remember(patch: Partial<typeof stored>) {
    workspace.updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, ...patch } }));
  }
  function chooseSubject(key: string | null) {
    setSelectedSubjectId(key); setSelectedTopicId(null); setSelectedIds([]);
    remember({ subjectId: key, topicId: null });
  }
  function chooseTopic(key: string | null) { setSelectedTopicId(key); remember({ topicId: key }); }
  function chooseStatus(next: CardStatus | "all") { setStatus(next); remember({ status: next }); }
  function chooseSort(next: SortKind) { setSort(next); remember({ sort: next }); }
  function switchStudy() {
    const next = !showStudy; setShowStudy(next); setSelectedTopicId(null); setStatus("all");
    setSelectedIds([]); setSelecting(false); setAdding(false); setEditingId(null);
    remember({ study: next, topicId: null, status: "all" });
    listRef.current?.scrollIntoView({ block: "start" });
  }
  function clearFilters() {
    setSelectedSubjectId(null); setSelectedTopicId(null); setSearch(""); setStatus("all");
    remember({ subjectId: null, topicId: null, status: "all" });
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      if (!showStudy && workspace.writable && event.key.toLowerCase() === "n") {
        event.preventDefault(); setAdding(true); setPrefill(null); setEditingId(null);
      }
    };
    document.addEventListener("keydown", keys); return () => document.removeEventListener("keydown", keys);
  }, [showStudy, workspace.writable]);
  useEffect(() => {
    if (!focusMistake) return;
    clearFocusMistake();
    if (focusMistake.practise) { setSession(focusMistake.ids?.length ? focusMistake.ids : [focusMistake.id]); return; }
    const entry = mistakes.find((item) => item.id === focusMistake.id);
    if (!entry) return;
    const topic = workspace.topicById.get(entry.topic_id);
    const subject = topic ? workspace.subjectById.get(topic.subject_id) : undefined;
    setShowStudy(false); setSelectedSubjectId(subject ? normalise(subject.name) : null);
    setSelectedTopicId(null); setStatus("all"); setHighlightId(entry.id);
    remember({ study: false, subjectId: subject ? normalise(subject.name) : null, topicId: null, status: "all" });
  }, [focusMistake, clearFocusMistake, mistakes, workspace.topicById, workspace.subjectById]);
  useEffect(() => {
    if (!highlightId) return;
    const scroll = window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('[data-mistake="' + highlightId + '"]')
      ?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    const clear = window.setTimeout(() => setHighlightId(null), 2500);
    return () => { window.clearTimeout(scroll); window.clearTimeout(clear); };
  }, [highlightId]);

  function startPractice(entries: KnowledgeEntry[]) {
    const eligible = entries.filter((entry) => entry.correction.trim());
    eligible.sort((a, b) => Number(practiceStatus.get(a.id)?.last?.outcome !== "incorrect") -
      Number(practiceStatus.get(b.id)?.last?.outcome !== "incorrect"));
    if (eligible.length) setSession(eligible.map((entry) => entry.id));
  }
  async function reviewStudy(items: MistakeCardItem[]) {
    const ordered = new Map<string, string[]>();
    for (const item of items) {
      if (!item.study) continue;
      const ids = ordered.get(item.study.packId) ?? [];
      if (!ids.includes(item.study.cardId)) ids.push(item.study.cardId);
      ordered.set(item.study.packId, ids);
    }
    const entries = [...ordered].map(([packId, cardIds]) => ({ packId, cardIds }));
    if (!entries.length) return;
    try {
      const reviewRouteToken = createReviewRoute(entries);
      await openCosmosWindow({ mode: "review", packId: entries[0].packId,
        source: "all", order: "weakest", count: "all",
        cardIds: entries[0].cardIds, reviewRouteToken });
      study.reload();
    } catch (reason) { workspace.toast(friendlyError(reason), { tone: "error" }); }
  }
  function logStudy(card: StudyMistake) {
    const notebookSubject = snapshot.subjects.find((subject) => normalise(subject.name) === normalise(card.subject));
    const latest = mistakes.find((entry) => notebookSubject &&
      workspace.topicById.get(entry.topic_id)?.subject_id === notebookSubject.id);
    const fallback = snapshot.topics.find((topic) => topic.subject_id === notebookSubject?.id);
    setSelectedSubjectId(notebookSubject ? normalise(notebookSubject.name) : null);
    setSelectedTopicId(null); setShowStudy(false); setAdding(true); setEditingId(null);
    setPrefill({ attempt: card.attempt, correction: card.title + " = " + card.reference, explanation: card.explanation });
    remember({ study: false, subjectId: notebookSubject ? normalise(notebookSubject.name) : null, topicId: null });
    setDraftTopicId(latest?.topic_id ?? fallback?.id ?? "");
  }
  const [draftTopicId, setDraftTopicId] = useState<string>("");
  const selectedNotebookSubject = snapshot.subjects.find((subject) => normalise(subject.name) === subjectKey);
  const chosenDefaultTopic = draftTopicId || (selectedTopicId && workspace.topicById.has(selectedTopicId) ? selectedTopicId : "") ||
    mistakes.find((entry) => !selectedNotebookSubject ||
      workspace.topicById.get(entry.topic_id)?.subject_id === selectedNotebookSubject.id)?.topic_id ||
    snapshot.topics.find((topic) => !selectedNotebookSubject || topic.subject_id === selectedNotebookSubject.id)?.id || "";

  async function moveSelected(topicId: string) {
    setBulkPicker(false);
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    const oldLocations = selectedIds.map((id) => ({ id, topicId: workspace.entryById.get(id)?.topic_id ?? "" }));
    let moved = 0;
    try {
      for (const id of selectedIds) { await workspace.patchEntry(id, { topic_id: topicId }); moved++; }
      const restore = oldLocations.slice(0, moved);
      workspace.toast("Moved " + moved + " mistakes.", { action: { label: "Undo", run: () => {
        void Promise.all(restore.filter((row) => row.topicId).map((row) =>
          workspace.patchEntry(row.id, { topic_id: row.topicId }))).catch((reason) =>
          workspace.toast(friendlyError(reason), { tone: "error" }));
      } } });
      setSelectedIds([]); setSelecting(false);
    } catch (reason) {
      workspace.toast("Moved " + moved + " before an error: " + friendlyError(reason), { tone: "error" });
      setSelectedIds((ids) => ids.slice(moved));
    } finally { setBulkBusy(false); }
  }
  async function applyRule() {
    if (!selectedIds.length || !bulkRule.trim() || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        const entry = workspace.entryById.get(id);
        if (!entry) continue;
        const detail = ruleParts(entry.title).detail;
        await workspace.patchEntry(id, { title: bulkRule.trim() + (detail ? " – " + detail : "") });
      }
      setSelectedIds([]); setSelecting(false); setBulkRule(""); workspace.toast("Rule updated.");
    } catch (reason) { workspace.toast(friendlyError(reason), { tone: "error" }); }
    finally { setBulkBusy(false); }
  }
  async function deleteSelected() {
    if (!selectedIds.length || bulkBusy) return;
    if (!await confirm({ title: "Delete " + selectedIds.length + " mistakes?",
      body: "The records and their recall history can be restored from Trash.", confirmLabel: "Move to Trash", danger: true })) return;
    setBulkBusy(true);
    try {
      for (const id of selectedIds) await workspace.removeEntry(id, { undo: false });
      setSelectedIds([]); setSelecting(false); workspace.toast("Moved mistakes to Trash.");
    } catch (reason) { workspace.toast(friendlyError(reason), { tone: "error" }); }
    finally { setBulkBusy(false); }
  }

  return <div className="ml-page hc-page" ref={listRef}>
    {confirmElement}
    <header className="hc-head">
      <div><h1>Mistake Log</h1>
        <p>{mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"} you logged · {study.items.length}
          {study.items.length === 1 ? " card" : " cards"} to work on from Study</p></div>
      <div className="hc-head-actions">
        <label className="hc-search"><Search size={15}/><span className="sr-only">Search mistakes</span>
          <input ref={searchRef} type="search" value={search} placeholder="Search"
            onChange={(event) => setSearch(event.target.value)}/></label>
        <button type="button" className="hc-from-study" aria-pressed={showStudy} onClick={switchStudy}>
          <Copy size={15}/> From Study <span>{study.items.length}</span></button>
        {!showStudy ? <button type="button" className="hc-primary" disabled={!visibleLogged.length}
          onClick={() => startPractice(visibleLogged)}><Play size={14} fill="currentColor"/> Practise {visibleLogged.length}</button> : null}
      </div>
    </header>
    {showStudy ? <div className="hc-study-banner">
      <div className="hc-study-icon"><Copy size={19}/></div>
      <div><strong>Cards to work on from Study</strong>
        <p>Flashcards you missed twice or more in Review. They leave this list once you get them right again.</p></div>
      <div className="hc-banner-actions"><button type="button" className="hc-primary" disabled={!filtered.length}
        onClick={() => void reviewStudy(filtered)}>Review these {filtered.length} in Study</button>
        <button type="button" onClick={switchStudy}>Back to my mistakes</button></div>
    </div> : null}
    {study.error ? <p className="hc-study-error" role="status">Cards from Study could not be loaded. {study.error}</p> : null}
    <div className="hc-filters">
      <button type="button" aria-pressed={!subjectKey} className={"hc-chip" + (!subjectKey ? " is-on" : "")}
        onClick={() => chooseSubject(null)}>All <small>{base.length}</small></button>
      {subjects.map((subject) => <button type="button" key={subject.value} aria-pressed={subjectKey === subject.value}
        className={"hc-chip" + (subjectKey === subject.value ? " is-on" : "")}
        onClick={() => chooseSubject(subject.value)}><span>{subject.glyph}</span>{subject.label} <small>{subject.count}</small></button>)}
      <span className="hc-separator"/>
      <CardFilter label="Topic" value={topicKey ?? ""} options={[
        { value: "", label: "All topics" }, ...topics.map((topic) => ({ ...topic })),
      ]} onChange={(key) => chooseTopic(key || null)}/>
      {!showStudy ? <CardFilter label="Show" value={status} options={SHOW_OPTIONS}
        onChange={(key) => chooseStatus(key as CardStatus | "all")}/> : null}
      <CardFilter label="Sort" value={sort}
        options={showStudy ? SORT_OPTIONS.filter((option) => option.value !== "fresh") : SORT_OPTIONS}
        onChange={(key) => chooseSort(key as SortKind)}/>
    </div>
    <div className="hc-count"><span>Showing <strong>{filtered.length}</strong> of {base.length}
      {activeFilters ? <> · <button type="button" onClick={clearFilters}>Clear filters</button></> : null}</span>
      {!showStudy && workspace.writable ? <button type="button" className="hc-select-toggle" aria-pressed={selecting}
        onClick={() => { setSelecting((value) => !value); setSelectedIds([]); }}>
        {selecting ? "Done selecting" : "Select"}</button> : null}
    </div>
    {selecting && !showStudy ? <div className="ml-bulk-toolbar ml-bulk-expanded" role="group" aria-label="Selected mistakes">
      <span className="ws-muted">{selectedIds.length} selected</span>
      <button className="ws-button" type="button" disabled={bulkBusy}
        onClick={() => setSelectedIds(filtered.flatMap((item) => item.entry ? [item.entry.id] : []))}>Select all visible</button>
      <button className="ws-button" type="button" disabled={!selectedIds.length || bulkBusy}
        onClick={() => setBulkPicker(true)}>Move to…</button>
      <input type="text" maxLength={200} className="ml-bulk-rule-input" value={bulkRule}
        placeholder="Set rule…" aria-label="Set rule on selected mistakes" onChange={(event) => setBulkRule(event.target.value)}/>
      <button className="ws-button" type="button" disabled={!selectedIds.length || !bulkRule.trim() || bulkBusy}
        onClick={() => void applyRule()}>Apply rule</button>
      <button className="ws-button ml-bulk-delete" type="button" disabled={!selectedIds.length || bulkBusy}
        onClick={() => void deleteSelected()}>Move to Trash</button>
    </div> : null}
    {bulkPicker ? <Portal><div className="ws-dialog-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setBulkPicker(false); }}>
      <TopicPicker value={selectedTopicId && workspace.topicById.has(selectedTopicId) ? selectedTopicId : null}
        onClose={() => setBulkPicker(false)} onChange={(id) => void moveSelected(id)}/>
    </div></Portal> : null}
    <div className="hc-grid">
      {!showStudy && workspace.writable && !selecting ? adding ? <AddMistakeTile key={"add:" + (prefill?.correction ?? "blank")}
        initialTopicId={chosenDefaultTopic} prefill={prefill}
        onCancel={() => { setAdding(false); setPrefill(null); setDraftTopicId(""); }}
        onSaved={(id) => { setHighlightId(id); setPrefill(null); setDraftTopicId("");
          setSelectedSubjectId(null); setSelectedTopicId(null); setSearch(""); setStatus("all");
          remember({ subjectId: null, topicId: null, status: "all" }); }}/> :
        <button type="button" className="hc-add-tile" onClick={() => { setAdding(true); setPrefill(null); setEditingId(null); }}>
          <Plus size={25}/><span>Add a mistake</span></button> : null}
      {filtered.map((item) => item.entry && editingId === item.entry.id
        ? <div className="hc-edit-row" key={item.id}><MistakeEditor entry={item.entry}
            onDone={() => setEditingId(null)}/></div>
        : <FlippingCard key={item.id} item={item} selecting={selecting} highlighted={highlightId === item.entry?.id}
          selected={Boolean(item.entry && selectedIds.includes(item.entry.id))}
          onSelect={() => { if (item.entry) setSelectedIds((ids) => ids.includes(item.entry!.id)
            ? ids.filter((id) => id !== item.entry!.id) : [...ids, item.entry!.id]); }}
          onEdit={() => { if (item.entry) { setEditingId(item.entry.id); setAdding(false); } }}
          onPractise={() => { if (item.entry) startPractice([item.entry]); }}
          onReview={() => void reviewStudy([item])}
          onLog={() => { if (item.study) logStudy(item.study); }}/>)}
      {!base.length && !study.loading ? <p className="hc-empty">{showStudy ?
        "Nothing to work on from Study right now." : "No mistakes yet. Write what you got wrong, and what's right."}</p>
        : !filtered.length ? <p className="hc-empty">Nothing matches these filters.
          <button type="button" onClick={clearFilters}>Clear filters</button></p> : null}
    </div>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)}/> : null}
  </div>;
}

function MistakeBulkAdd({ topicId }: { topicId: string }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rawLines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const lines = rawLines.map((raw) => ({ raw, result: parseCaptureLine(raw) }));
  const valid = lines.filter((item) => item.result.kind === "mistake" && item.result.attempt.trim()
    && item.result.attempt.length <= 5000 && item.result.correction.length <= 5000);
  const rejected = lines.length - valid.length;

  async function addAll() {
    if (busy || !valid.length || rejected || valid.length > 50) return;
    setBusy(true); setError("");
    let saved = 0, skipped = 0;
    const known = new Set(workspace.snapshot.entries.filter((entry) => entry.kind === "mistake"
      && workspace.topicById.get(entry.topic_id)?.subject_id === workspace.topicById.get(topicId)?.subject_id)
      .map((entry) => comparableCorrection(entry.attempt) + "\u0000" + comparableCorrection(entry.correction)));
    try {
      for (const item of valid) {
        const parsed = item.result;
        if (parsed.kind !== "mistake") continue;
        const key = comparableCorrection(parsed.attempt) + "\u0000" + comparableCorrection(parsed.correction);
        if (known.has(key)) { skipped++; continue; }
        await workspace.addEntry({ kind: "mistake", topicId, attempt: parsed.attempt,
          correction: parsed.correction, explanation: parsed.explanation });
        known.add(key); saved++;
      }
      setText(""); setOpen(false);
      workspace.toast("Added " + saved + " mistakes" + (skipped ? "; skipped " + skipped + " exact duplicates." : "."));
    } catch (reason) {
      // Keep the input on failure so the user can recover it; successful rows
      // will be skipped on the next attempt by exact-pair matching.
      setError("Saved " + saved + " before an error. Input retained. " + friendlyError(reason));
    } finally { setBusy(false); }
  }
  return <div className="ml-bulk-add">
    <button type="button" className="nb-link-button" onClick={() => setOpen((current) => !current)}>
      {open ? "Close bulk paste" : "Paste a list of mistakes"}
    </button>
    {open ? <div className="ml-bulk-panel">
      <label className="ws-field"><span>One correction per line: wrong → right // why</span>
        <textarea rows={5} value={text} placeholder={"Wrong sentence → Correct sentence // Explanation\nAnother error → Another correction"}
          onChange={(event) => { setText(event.target.value); setError(""); }} disabled={busy}/>
      </label>
      {rawLines.length ? <small>{valid.length} ready{rejected ? " · " + rejected + " invalid lines" : ""}
        {valid.length > 50 ? " · maximum 50 per batch" : ""} · German, Chinese and other subjects use the same format</small> : null}
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      <button type="button" className="ws-button is-primary" disabled={busy || !valid.length || Boolean(rejected) || valid.length > 50}
        onClick={() => void addAll()}>{busy ? "Adding…" : "Add " + valid.length + " mistakes"}</button>
    </div> : null}
  </div>;
}


function isIdeaStyle(entry: KnowledgeEntry): boolean {
  if (!entry.correction.trim()) return false;
  const original = entry.attempt.trim();
  const corrected = entry.correction.trim();
  // Short Hanzi sentences need character-level comparison, not a whitespace heuristic.
  if (/[\u3400-\u9fff]/u.test(original + corrected) && Math.max(original.length, corrected.length) < 120) return false;
  const a = original.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const b = corrected.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (a.length > 30 || b.length > 30) return true;
  const remaining = [...b];
  let common = 0;
  for (const token of a) {
    const index = remaining.indexOf(token);
    if (index >= 0) { common += 1; remaining.splice(index, 1); }
  }
  return Math.max(a.length, b.length) > 4 && common / Math.max(a.length, b.length) < 0.5;
}

function MistakeEditor({ entry, preferredSubjectId, preferredTopicId, onDone }: {
  entry?: KnowledgeEntry; preferredSubjectId?: string | null; preferredTopicId?: string | null; onDone: () => void;
}) {
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  const originalRule = ruleParts(entry?.title ?? "");
  const [topicId, setTopicId] = useState(entry?.topic_id ?? preferredTopicId ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attempt, setAttempt] = useState(entry?.attempt ?? "");
  const [correction, setCorrection] = useState(entry?.correction ?? "");
  const [rule, setRule] = useState(originalRule.rule);
  const [explanation, setExplanation] = useState(entry?.explanation ?? "");
  const [pinned, setPinned] = useState(Boolean(entry?.pinned));
  const explanationRef = useRef<RichEditorHandle>(null);
  const [notesOpen, setNotesOpen] = useState(Boolean(entry?.explanation));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy) return;
    if (!attempt.trim()) { setError("Write the mistake first. The correction can be added later."); return; }
    if (!topicId || !workspace.topicById.has(topicId)) {
      setError("Choose a topic. You can create one in the destination picker.");
      return;
    }
    setBusy(true); setError("");
    const title = rule.trim() + (rule.trim() && originalRule.detail ? " – " + originalRule.detail : "");
    try {
      if (entry) {
        await workspace.patchEntry(entry.id, {
          attempt: attempt.trim(), correction: correction.trim(), title,
          explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(),
          topic_id: topicId, pinned,
        });
      } else {
        await workspace.addEntry({
          kind: "mistake", topicId, title, attempt: attempt.trim(),
          correction: correction.trim(), explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(),
        });
      }
      onDone();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!entry || busy) return;
    if (!await confirm({ title: "Delete this mistake?", body: "You can undo this deletion immediately afterwards.", confirmLabel: "Delete mistake", danger: true })) return;
    setBusy(true);
    try { await workspace.removeEntry(entry.id); onDone(); }
    catch (reason) { setError(friendlyError(reason)); setBusy(false); }
  }

  return <>{confirmElement}<form className="ml-simple-edit" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape" && !pickerOpen) { event.preventDefault(); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(); }
    }}>
    <div className="ml-edit-head"><strong>{entry ? "Edit mistake" : "New mistake"}</strong>
      <button type="button" className="ws-icon-button" aria-label="Cancel editing" disabled={busy}
        onClick={onDone}><X size={16}/></button>
    </div>
    <label className="ws-field">
      <span>Mistake</span>
      <textarea autoFocus rows={2} maxLength={5000} value={attempt}
        placeholder="What did you get wrong?" onChange={(event) => setAttempt(event.target.value)}/>
    </label>
    <label className="ws-field">
      <span>Correction</span>
      <textarea rows={2} maxLength={5000} value={correction}
        placeholder="What is the correct version?" onChange={(event) => setCorrection(event.target.value)}/>
    </label>
    {attempt.trim().length > 0 && attempt.length < 240 && !correction.trim()
      ? <button type="button" className="nb-link-button ml-copy-mistake"
        onClick={() => setCorrection(attempt)}>Copy mistake to correction</button> : null}
    <div className="ml-edit-options">
      <label className="ws-field">
        <span>Rule <small>(optional)</small></span>
        <input type="text" maxLength={200} value={rule} placeholder="Adjektivendung, Compound interest…"
          onChange={(event) => setRule(event.target.value)}/>
      </label>
      <div className="ws-field">
        <span>Location</span>
        <button type="button" className="ws-button ml-destination" onClick={() => setPickerOpen(true)}>
          {topicId ? workspace.pathLabel(topicId) : preferredSubjectId
            ? "Choose topic in " + (workspace.subjectById.get(preferredSubjectId)?.name ?? "subject")
            : "Choose subject and topic"}
          <ChevronRight size={15}/>
        </button>
      </div>
    </div>
    {entry ? <label className="ml-pin-option"><input type="checkbox" checked={pinned}
      onChange={(event) => setPinned(event.target.checked)}/> Pin this mistake</label> : null}
    {pickerOpen ? <Portal><div className="ws-dialog-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
      <TopicPicker value={topicId || null} onClose={() => setPickerOpen(false)}
        onChange={(id) => { setTopicId(id); setPickerOpen(false); setError(""); }}/>
    </div></Portal> : null}
    <details className="ml-edit-notes" open={notesOpen} onToggle={(event) => setNotesOpen(event.currentTarget.open)}>
      <summary>Explanation &amp; examples <small>— optional</small></summary>
      <div className="ml-explanation-editor">
        <RichEditor ref={explanationRef} resetKey={entry?.id ?? "new-mistake"} value={explanation}
          ariaLabel="Formatted explanation" placeholder="Why was this wrong? Add a rule or short explanation."
          onChange={setExplanation} onSave={() => void save()} onDone={() => void save()} compactToolbar/>
      </div>
    </details>
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    <div className="ml-simple-edit-actions">
      {entry ? <button className="ws-button ml-delete-in-editor" type="button" disabled={busy}
        onClick={() => void remove()}><Trash2 size={14}/> Delete</button> : null}
      <button className="ws-button" type="button" disabled={busy} onClick={onDone}>Cancel</button>
      <button className="ws-button is-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  </form></>;
}

// ---------------------------------------------------------------------------
// Recall: produce the corrected form before seeing it, then grade yourself.
// ---------------------------------------------------------------------------
// Compare written answers without stripping the distinctions learners must master:
// German capitals/umlauts, Cyrillic й/и and Mandarin pinyin tones.

function RecallSession({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const workspace = useWorkspace();
  const [index, setIndex] = useState(0);
  const [roundLimit, setRoundLimit] = useState(10);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [missed, setMissed] = useState(false);
  const [hint, setHint] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; correct: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queue = useMemo(() => ids.map((id) => workspace.entryById.get(id)).filter((entry): entry is KnowledgeEntry => Boolean(entry?.correction)), [ids, workspace.entryById]);
  const current = queue[index];
  const finished = index >= queue.length;
  const roundComplete = !finished && index >= roundLimit;

  useEffect(() => { if (!finished && !roundComplete) window.requestAnimationFrame(() => inputRef.current?.focus()); }, [finished, roundComplete, index]);

  const next = useCallback(() => {
    setIndex((value) => value + 1);
    setAnswer(""); setRevealed(false); setHint(false); setMissed(false);
  }, []);

  const grade = useCallback(async (correct: boolean, showBeforeNext = false) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (workspace.writable) await workspace.practise(current.id, correct ? "correct" : "incorrect", answer);
      setResults((list) => [...list, { id: current.id, correct }]);
      if (showBeforeNext) { setMissed(true); setRevealed(true); }
      else next();
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
    finally { setBusy(false); }
  }, [answer, busy, current, next, workspace]);

  const ideaRecall = Boolean(current && isIdeaStyle(current));
  const exact = Boolean(current && answer.trim() && comparableCorrection(answer) === comparableCorrection(current.correction));

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <div className="ws-dialog is-recall" role="dialog" aria-modal="true" aria-labelledby="recall-title"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (!finished && !roundComplete && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault(); if (!revealed) setRevealed(true);
        }
        if (!finished && !roundComplete && revealed && !missed && !busy && !event.ctrlKey && !event.metaKey && !event.altKey) {
          if (event.key === "1") { event.preventDefault(); void grade(false); }
          if (event.key === "2") { event.preventDefault(); void grade(true); }
        }
      }}>
      <div className="ws-dialog-head">
        <h2 id="recall-title"><GraduationCap size={17} /> Recall {queue.length > 1 && !finished ? <small>{index + 1} of {queue.length}</small> : null}</h2>
        <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      {finished || roundComplete ? <div className="recall-summary">
        <strong>{results.filter((result) => result.correct).length} of {results.length} recalled</strong>
        <p className="ws-muted">{finished ? "Practice history saved." : index + " of " + queue.length + " reviewed so far."}</p>
        <div className="ws-dialog-actions">
          <button type="button" className="ws-button" onClick={onClose}>Done</button>
          {!finished ? <button type="button" className="ws-button is-primary" autoFocus
            onClick={() => setRoundLimit((count) => count + 10)}>10 more</button> : null}
        </div>
      </div> : current ? <>
        <div className="recall-prompt">
          <span className="ml-label">{workspace.pathLabel(current.topic_id)}</span>
          {current.attempt ? <p className="recall-attempt"><span className="ml-label">Mistake</span>{current.attempt}</p> : <p className="ws-muted">Recall the correct form{current.title ? ` for “${current.title}”` : ""}.</p>}
          {current.explanation ? (hint || revealed ? <div className="recall-hint"><span className="ml-label">Why</span><RichText text={current.explanation} className="is-compact" /></div>
            : <button type="button" className="nb-link-button" onClick={() => setHint(true)}>Show the explanation as a hint</button>) : null}
        </div>
        <label className="ws-field"><span>{ideaRecall ? "In your own words (optional)" : "Write the corrected version from memory"}</span>
          <textarea ref={inputRef} rows={ideaRecall ? 3 : 2} value={answer} readOnly={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder={ideaRecall ? "Explain the correct idea…" : "Type it before revealing…"} /></label>
        {revealed ? <div className={"recall-result " + (ideaRecall ? "" : answer.trim() ? (exact ? "is-exact" : "is-different") : "")}>
          <span className="ml-label">Correct form</span>
          {!ideaRecall && answer.trim() && !exact ? <p className="recall-user-answer"><DiffLine parts={mistakeDifference(answer, current.correction).before}/></p> : null}
          <p className="recall-answer">{ideaRecall ? current.correction : <DiffLine parts={mistakeDifference(answer, current.correction).after}/>}</p>
          <small>{ideaRecall ? "Compare your reasoning, then grade yourself."
            : !answer.trim() ? "Read the answer before continuing."
            : exact ? "Exact match." : "Differences are underlined above."}</small>
        </div> : null}
        <div className="ws-dialog-actions">
          {!revealed ? <>
            <button type="button" className="ws-button" onClick={() => void grade(false, true)} disabled={busy}>Missed</button>
            <button type="button" className="ws-button is-primary" onClick={() => setRevealed(true)}>Reveal <Kbd>{MOD_KEY} ↵</Kbd></button>
          </> : missed ? <button type="button" className="ws-button is-primary" onClick={next}>Next</button> : <>
            <button type="button" className="ws-button" onClick={() => void grade(false)} disabled={busy}>Missed</button>
            <button type="button" className="ws-button is-primary" onClick={() => void grade(true)} disabled={busy}><Check size={15} /> Recalled</button>
          </>}
        </div>
      </> : <p className="ws-muted">These mistakes have no correction to recall yet.</p>}
    </div>
  </div></Portal>;
}
