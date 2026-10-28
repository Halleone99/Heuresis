import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, BookOpen, Check, ChevronRight, CircleHelp, FileText, FolderPlus, GraduationCap, MessageSquareQuote, Plus, Puzzle, Search, X } from "lucide-react";
import { CATEGORY_LABELS, isLesson, normaliseSearch, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { useWorkspace } from "./WorkspaceContext";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function parseDay(value: string | null | undefined) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function formatDay(value: string | null | undefined) {
  const date = parseDay(value);
  if (!date) return "";
  return date.getFullYear() === new Date().getFullYear() ? DAY.format(date) : DAY_YEAR.format(date);
}
export function formatLongDay(value: string | null | undefined) {
  const date = parseDay(value);
  return date ? formatDay(value) : "";
}
export function formatTime(value: string | null | undefined) {
  const date = parseDay(value);
  return date ? TIME.format(date) : "";
}
export function relativeTime(value: string | null | undefined) {
  const date = parseDay(value);
  if (!date) return "";
  const now = new Date();
  const elapsed = now.getTime() - date.getTime();
  // Future timestamps can occur during clock skew; do not say "−2 h ago".
  if (elapsed < -60_000) return formatDay(value);
  const minutes = Math.max(0, Math.floor(elapsed / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  // Calendar-day boundaries, not elapsed-hour rounding, govern yesterday.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((today - then) / 86400000);
  if (days === 0) return `${Math.floor(elapsed / 3600000)} h ago`;
  if (days === 1) return "yesterday";
  if (days <= 6) return `${days} days ago`;
  return formatDay(value);
}
export function dueLabel(value: string | null | undefined) {
  const date = parseDay(value);
  if (!date) return "";
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days <= 0) return "due now";
  if (days === 1) return "due tomorrow";
  if (days < 14) return `due in ${days} days`;
  return `due ${formatDay(value)}`;
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------
export function KindIcon({ entry, size = 15 }: { entry: KnowledgeEntry; size?: number }) {
  if (entry.kind === "mistake") return <AlertTriangle size={size} />;
  if (isLesson(entry)) return <GraduationCap size={size} />;
  if (entry.category === "question") return <CircleHelp size={size} />;
  if (entry.category === "phrase") return <MessageSquareQuote size={size} />;
  if (entry.category === "grammar") return <Puzzle size={size} />;
  if (entry.category === "vocabulary") return <BookOpen size={size} />;
  return <FileText size={size} />;
}

export function entryKindLabel(entry: KnowledgeEntry) {
  if (entry.kind === "mistake") return "Mistake";
  if (isLesson(entry)) return "Lesson";
  return CATEGORY_LABELS[entry.category ?? "note"];
}


export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="ws-empty">
    {icon ? <span className="ws-empty-icon" aria-hidden="true">{icon}</span> : null}
    <strong>{title}</strong>
    {children ? <p>{children}</p> : null}
    {action}
  </div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ws-kbd">{children}</kbd>;
}

export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Dialogs render at the document root so no sticky or scrolling ancestor can trap them. */
export function Portal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? <>{children}</> : createPortal(children, document.body);
}

// ---------------------------------------------------------------------------
// Confirmation dialog (promise based, keyboard accessible)
// ---------------------------------------------------------------------------
type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setState({ ...options, resolve });
  }), []);
  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
    const target = priorFocus.current;
    priorFocus.current = null;
    if (target && document.contains(target)) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  };
  const element = state ? <Portal><div className="ws-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}>
    <div className="ws-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ws-confirm-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(false); }
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          if (!buttons.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <h2 id="ws-confirm-title">{state.title}</h2>
      {state.body ? <div className="ws-dialog-body">{state.body}</div> : null}
      <div className="ws-dialog-actions">
        <button type="button" className="ws-button" onClick={() => close(false)}>Cancel</button>
        <button type="button" autoFocus className={`ws-button ${state.danger ? "is-danger" : "is-primary"}`} onClick={() => close(true)}>{state.confirmLabel ?? "Confirm"}</button>
      </div>
    </div>
  </div></Portal> : null;
  return [element, confirm] as const;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function Toaster() {
  const { toasts, dismissToast } = useWorkspace();
  return <div className="ws-toasts" role="status" aria-live="polite">
    {toasts.map((toast) => <div key={toast.id} className={`ws-toast ${toast.tone === "error" ? "is-error" : ""}`}>
      {toast.tone === "error" ? <AlertTriangle size={15} /> : <Check size={15} />}
      <span>{toast.message}</span>
      {toast.action ? <button type="button" onClick={() => { toast.action?.run(); dismissToast(toast.id); }}>{toast.action.label}</button> : null}
      <button type="button" className="ws-toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}><X size={13} /></button>
    </div>)}
  </div>;
}

// ---------------------------------------------------------------------------
// Inline name form (subjects / topics) — no native prompt()
// ---------------------------------------------------------------------------
export function InlineNameForm({ label, placeholder, initial = "", submitLabel = "Create", onSubmit, onCancel, suggestions = [] }: {
  label: string; placeholder?: string; initial?: string; submitLabel?: string;
  onSubmit: (value: string) => Promise<void>; onCancel: () => void; suggestions?: string[];
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(name = value) {
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try { await onSubmit(name); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : String(submitError)); }
    finally { setBusy(false); }
  }
  return <form className="ws-inline-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <input autoFocus aria-label={label} value={value} maxLength={120} placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }} />
    {suggestions.length ? <div className="ws-inline-suggestions">{suggestions.map((name) =>
      <button type="button" key={name} onClick={() => void submit(name)}>{name}</button>)}</div> : null}
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    <div className="ws-inline-actions">
      <button type="submit" className="ws-button is-primary is-small" disabled={busy || !value.trim()}>{busy ? "Saving…" : submitLabel}</button>
      <button type="button" className="ws-button is-quiet is-small" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

// ---------------------------------------------------------------------------
// Topic picker: one searchable list of "Language › Topic › Sub-topic"
// ---------------------------------------------------------------------------
export function TopicPicker({ value, onChange, onClose, allowCreate = true }: {
  value: string | null; onChange: (topicId: string) => void; onClose: () => void; allowCreate?: boolean;
}) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<null | { subjectId: string | null; parentId: string | null }>(null);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => {
    const rows: Array<{ id: string; label: string; depth: number; subjectId: string }> = [];
    const subjects = [...workspace.snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));
    for (const subject of subjects) {
      const walk = (parentId: string | null, depth: number) => {
        for (const topic of workspace.childrenOf(parentId, subject.id)) {
          rows.push({ id: topic.id, label: workspace.pathLabel(topic.id), depth, subjectId: subject.id });
          walk(topic.id, depth + 1);
        }
      };
      walk(null, 0);
    }
    const q = normaliseSearch(query);
    return q ? rows.filter((row) => q.split(" ").every((word) => normaliseSearch(row.label).includes(word))) : rows;
  }, [query, workspace]);

  useEffect(() => { setHighlight(Math.max(0, options.findIndex((row) => row.id === value))); }, [options, value]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const selectedSubject = value ? workspace.topicById.get(value)?.subject_id ?? null : workspace.snapshot.subjects[0]?.id ?? null;

  if (creating) {
    const subject = creating.subjectId ? workspace.subjectById.get(creating.subjectId) : null;
    return <div className="ws-picker">
      <div className="ws-picker-head"><strong>{subject ? `New topic in ${subject.name}` : "New subject"}</strong>
        <button type="button" className="ws-icon-button" aria-label="Close" onClick={() => setCreating(null)}><X size={14} /></button></div>
      <InlineNameForm label={subject ? "Topic name" : "Subject name"} placeholder={subject ? "Grammar, Lesson 7, Inbox…" : "German, Finance, History…"}
        initial={query} onCancel={() => setCreating(null)}
        onSubmit={async (name) => {
          if (subject) {
            const topic = await workspace.addTopic(subject.id, name, creating.parentId);
            onChange(topic.id);
          } else {
            const created = await workspace.addSubject(name);
            const inbox = await workspace.ensureInbox(created.id);
            onChange(inbox.id);
          }
        }} />
    </div>;
  }

  return <div className="ws-picker" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((index) => Math.min(options.length - 1, index + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((index) => Math.max(0, index - 1)); }
    if (event.key === "Enter") { event.preventDefault(); const row = options[highlight]; if (row) onChange(row.id); }
  }}>
    <label className="ws-picker-search"><Search size={14} />
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a topic…" aria-label="Find a topic" /></label>
    <div className="ws-picker-list" role="listbox" ref={listRef}>
      {options.map((row, index) => <button type="button" role="option" key={row.id} data-index={index}
        aria-selected={row.id === value}
        className={`${row.id === value ? "is-selected" : ""} ${index === highlight ? "is-highlighted" : ""}`}
        onMouseEnter={() => setHighlight(index)} onClick={() => onChange(row.id)}>
        <span>{row.label.split(" › ").map((part, partIndex, parts) => <span key={partIndex} className={partIndex === parts.length - 1 ? "is-leaf" : ""}>
          {part}{partIndex < parts.length - 1 ? <ChevronRight size={11} /> : null}</span>)}</span>
        {row.id === value ? <Check size={14} /> : null}
      </button>)}
      {!options.length ? <p className="ws-muted ws-picker-empty">{workspace.snapshot.topics.length ? "No topic matches." : "No topics yet."}</p> : null}
    </div>
    {allowCreate && workspace.writable ? <div className="ws-picker-foot">
      {selectedSubject ? <button type="button" onClick={() => setCreating({ subjectId: selectedSubject, parentId: null })}><Plus size={13} /> New topic in {workspace.subjectById.get(selectedSubject)?.name}</button> : null}
      <button type="button" onClick={() => setCreating({ subjectId: null, parentId: null })}><FolderPlus size={13} /> New subject</button>
    </div> : null}
  </div>;
}

/** Close a popover when clicking outside it or pressing Escape. */
export function usePopover(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Capture before the note's own Escape handler can close the whole page.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey, true); };
  }, [onClose, open]);
  return ref;
}

/**
 * Long lists (an Inbox with a thousand captures, the complete Mistake Log) render
 * in pages: the first page at once, the next when the end of the list scrolls
 * into view, with a button as the keyboard/touch fallback. Rendering everything
 * took seconds on a desktop and much longer on a tablet.
 */
export function useProgressiveList<T>(items: T[], resetKey: string, pageSize = 120) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => { setLimit(pageSize); }, [resetKey, pageSize]);
  const showMore = useCallback(() => setLimit((current) => current + pageSize), [pageSize]);
  /** Make sure a given index is rendered (e.g. a mistake opened from search). */
  const reveal = useCallback((index: number) => {
    if (index >= 0) setLimit((current) => Math.max(current, Math.ceil((index + 1) / pageSize) * pageSize));
  }, [pageSize]);
  return { visible: items.slice(0, limit), remaining: Math.max(0, items.length - limit), showMore, reveal };
}

export function ShowMore({ remaining, onMore, label = "items" }: { remaining: number; onMore: () => void; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !remaining || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) onMore(); }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore, remaining]);
  if (!remaining) return null;
  return <button ref={ref} type="button" className="ws-button ws-show-more" onClick={onMore}>Show more · {remaining.toLocaleString()} more {label}</button>;
}
