import { useMemo, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import {
  type ReadingBook, type SavedQuote, useReadingLibrary,
} from "../../lib/readingBridge";
import {
  readJournalNotes, type JournalDraft, type JournalKind,
} from "../../lib/readingJournal";
import "./reading-journal.css";

type EntryKind = JournalKind | "quote";
type Filter = EntryKind | "all";
type ReadingApi = ReturnType<typeof useReadingLibrary>;
type Entry = {
  id: string; source: "journal" | "quote"; kind: EntryKind; text: string;
  reference: string; explanation: string; createdAt: string;
};
const LABELS: Record<EntryKind, string> = {
  interesting: "Interesting", question: "Questions", reflection: "Reflections", quote: "Quotes",
};
const EMPTY: Omit<JournalDraft, "kind"> & { kind: EntryKind } = {
  kind: "interesting", text: "", reference: "", explanation: "",
};

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ReadingJournal({ book, api }: { book: ReadingBook; api: ReadingApi }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const notes: Entry[] = readJournalNotes(book.notes).map((entry) => ({
      id: entry.id, source: "journal", kind: entry.kind, text: entry.text,
      reference: entry.reference, explanation: entry.explanation, createdAt: entry.createdAt,
    }));
    const quotations: Entry[] = api.quotes.filter((quote: SavedQuote) => quote.readingId === book.id).map((quote) => ({
      id: quote.id, source: "quote", kind: "quote", text: quote.text,
      reference: quote.page, explanation: "", createdAt: quote.createdAt,
    }));
    return [...notes, ...quotations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [book.id, book.notes, api.quotes]);
  const visible = filter === "all" ? entries : entries.filter((entry) => entry.kind === filter);

  function add(kind: EntryKind = filter === "all" ? "interesting" : filter) {
    setDraft({ ...EMPTY, kind }); setEditing(null); setDeleting(null); setError(""); setSaved("");
  }
  function edit(entry: Entry) {
    setEditing(entry); setDraft({
      kind: entry.kind, text: entry.text, reference: entry.reference, explanation: entry.explanation,
    }); setDeleting(null); setError(""); setSaved("");
  }
  async function save() {
    if (!draft || busy || !draft.text.trim()) return;
    setBusy(true); setError(""); setSaved("");
    try {
      if (draft.kind === "quote") {
        const quoteDraft = {
          text: draft.text, readingId: book.id,
          attribution: book.author, page: draft.reference,
        };
        if (editing) await api.updateQuote(editing.id, quoteDraft);
        else await api.addQuote(quoteDraft);
      } else {
        await api.saveJournalEntry(book.id, {
          kind: draft.kind, text: draft.text, reference: draft.reference, explanation: draft.explanation,
        }, editing?.id);
      }
      setDraft(null); setEditing(null); setSaved("Saved to this book.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      if (deleting.source === "quote") await api.removeQuote(deleting.id);
      else await api.removeJournalEntry(book.id, deleting.id);
      setDeleting(null); setSaved("Entry deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return <section className="lit-journal" aria-label="Reading journal">
    <div className="lit-journal-head">
      <div><h3>My reading journal</h3><p>Keep what interests you, puzzles you, or deserves another look.</p></div>
      <button type="button" className="lit-button is-primary" disabled={busy} onClick={() => add()}><Plus size={15}/> Add entry</button>
    </div>
    <div className="lit-journal-filters" role="group" aria-label="Filter reading entries">
      {(["all", "interesting", "question", "reflection", "quote"] as Filter[]).map((kind) => {
        const count = kind === "all" ? entries.length : entries.filter((item) => item.kind === kind).length;
        return <button type="button" key={kind} className={filter === kind ? "is-active" : ""}
          aria-pressed={filter === kind} onClick={() => { setFilter(kind); setSaved(""); }}>
          {kind === "all" ? "All" : LABELS[kind]} <span>{count}</span>
        </button>;
      })}
    </div>

    {draft ? <form className="lit-journal-composer" aria-label={editing ? "Edit reading entry" : "New reading entry"}
      onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="lit-field">Type
        <span className="lit-journal-select"><select disabled={Boolean(editing) || busy} value={draft.kind}
          onChange={(event) => setDraft({ ...draft, kind: event.target.value as EntryKind, explanation: "" })}>
          <option value="interesting">Interesting</option>
          <option value="question">Question</option>
          <option value="reflection">Reflection</option>
          <option value="quote">Quote</option>
        </select><ChevronDown size={14}/></span>
      </label>
      <label className="lit-field">
        {draft.kind === "quote" ? "Quotation" : draft.kind === "question" ? "What didn't you understand?" : "Your note"}
        <textarea autoFocus required rows={4} maxLength={10000} value={draft.text}
          placeholder={draft.kind === "quote" ? "Copy the passage here…" : draft.kind === "question" ? "Write your question or the passage that puzzled you…" : "Capture the idea in your own words…"}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}/>
      </label>
      {draft.kind === "question" ? <label className="lit-field">Explanation or answer <small>(optional — add it later)</small>
        <textarea rows={3} maxLength={10000} value={draft.explanation} placeholder="What you understood after discussing it…"
          onChange={(event) => setDraft({ ...draft, explanation: event.target.value })}/>
      </label> : null}
      <label className="lit-field">Page or chapter <small>(optional)</small>
        <input maxLength={250} value={draft.reference} placeholder="e.g. p. 42, chapter 3"
          onChange={(event) => setDraft({ ...draft, reference: event.target.value })}/>
      </label>
      {error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
      <div className="lit-form-actions">
        <button type="button" className="lit-button" disabled={busy} onClick={() => { setDraft(null); setEditing(null); setError(""); }}>Cancel</button>
        <button type="submit" className="lit-button is-primary" disabled={busy || !draft.text.trim()}>{busy ? "Saving…" : editing ? "Save changes" : "Save entry"}</button>
      </div>
    </form> : null}

    {!draft && !entries.length ? <div className="lit-journal-empty">
      Nothing saved for this book yet. Add your first observation, question, reflection or quotation.
    </div> : null}
    {!draft && entries.length > 0 && visible.length === 0 ? <div className="lit-journal-empty">
      No {filter === "all" ? "entries" : LABELS[filter].toLowerCase()} yet.
    </div> : null}
    <div className="lit-journal-entries">
      {visible.map((entry) => <article className="lit-journal-entry" key={entry.source + ":" + entry.id}>
        <div className="lit-journal-entry-top">
          <span className="lit-journal-kind" data-kind={entry.kind}>{LABELS[entry.kind]}</span>
          <span className="lit-journal-date">{[entry.reference, displayDate(entry.createdAt)].filter(Boolean).join(" · ")}</span>
        </div>
        <p className={entry.kind === "quote" ? "is-quotation" : ""}>{entry.text}</p>
        {entry.kind === "question" && entry.explanation ? <div className="lit-journal-answer"><strong><Check size={13}/> Explained</strong><p>{entry.explanation}</p></div> : null}
        {entry.kind === "question" && !entry.explanation ? <span className="lit-journal-unresolved">Not yet explained</span> : null}
        <div className="lit-journal-entry-actions">
          <button type="button" className="lit-icon" title="Edit entry" aria-label={"Edit " + LABELS[entry.kind]} disabled={busy}
            onClick={() => edit(entry)}><Pencil size={15}/></button>
          <button type="button" className="lit-icon" title="Delete entry" aria-label={"Delete " + LABELS[entry.kind]} disabled={busy}
            onClick={() => { setDeleting(entry); setDraft(null); setError(""); setSaved(""); }}><Trash2 size={15}/></button>
        </div>
        {deleting?.id === entry.id && deleting.source === entry.source ? <div className="lit-journal-confirm" role="group" aria-label="Confirm deletion">
          <span>Delete this entry?</span>
          <button type="button" className="lit-button" disabled={busy} onClick={() => setDeleting(null)}>Keep</button>
          <button type="button" className="lit-button is-danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete"}</button>
        </div> : null}
      </article>)}
    </div>
    {!draft && error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
    {!draft && saved ? <p className="lit-journal-saved" role="status"><Check size={14}/>{saved}</p> : null}
  </section>;
}
