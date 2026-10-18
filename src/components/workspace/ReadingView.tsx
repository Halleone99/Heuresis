import { useMemo, useState } from "react";
import { BookOpen, BookPlus, ChevronRight, Clock3, LibraryBig, Plus, Quote, Search, X } from "lucide-react";
import { ReadingJournal } from "./ReadingJournal";
import {
  bookDomain, bookMinutes, bookProgress, bookShelf, notesWithShelf, useReadingLibrary,
  type BookDraft, type ReadingBook, type ReadingStatus,
} from "../../lib/readingBridge";

type Tab = "current" | "next" | "catalogue" | "archive";
const TABS: Array<{ id: Tab; title: string }> = [
  { id: "current", title: "Reading now" }, { id: "next", title: "Up next" },
  { id: "catalogue", title: "Catalogue" }, { id: "archive", title: "Archive" },
];
const EMPTY: BookDraft = { title: "", author: "", status: "To read", importance: 2 };
const STATUSES: ReadingStatus[] = ["To read", "Reading", "Read", "Abandoned"];
function minutesLabel(value: number) {
  return value >= 60 ? `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min` : `${value} min`;
}
function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 4).map((word) => word[0]?.toUpperCase()).join("");
}
function BookCover({ book, index }: { book: ReadingBook; index: number }) {
  return <div className="lit-book-cover" data-colour={index % 6} aria-hidden="true">
    <span className="lit-cover-emblem">✦</span>
    <strong>{book.title}</strong>
    <small>{book.author || "Unknown author"}</small>
  </div>;
}

export function ReadingView({ userId, onOpenQuotations }: { userId: string; onOpenQuotations: (bookId: string) => void }) {
  const api = useReadingLibrary(userId);
  const [tab, setTab] = useState<Tab>("current");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BookDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [pageValue, setPageValue] = useState("");
  const selected = api.books.find((book) => book.id === selectedId) ?? null;

  const counts: Record<Tab, number> = {
    current: api.books.filter((book) => book.status === "Reading").length,
    next: api.books.filter((book) => book.status === "To read" && bookShelf(book) === "next").length,
    catalogue: api.books.length,
    archive: api.books.filter((book) => book.status === "Read" || book.status === "Abandoned").length,
  };
  const filtered = useMemo(() => api.books.filter((book) => {
    if (tab === "current" && book.status !== "Reading") return false;
    if (tab === "next" && !(book.status === "To read" && bookShelf(book) === "next")) return false;
    if (tab === "archive" && book.status !== "Read" && book.status !== "Abandoned") return false;
    return [book.title, book.author, bookDomain(book)].join(" ").toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => a.title.localeCompare(b.title)), [api.books, tab, query]);

  async function execute(operation: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setProblem(""); setBusy(true);
    try { await operation(); after?.(); }
    catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function openBook(book: ReadingBook) {
    setSelectedId(book.id); setProblem(""); setMinutes("30");
    const progress = bookProgress(book);
    setPageValue(progress ? `${progress.page}/${progress.pages}` : "");
  }
  function saveBook() {
    if (!form) return;
    const draft = form;
    void execute(async () => {
      if (editId) await api.updateBook(editId, draft);
      else await api.addBook(draft);
    }, () => { setForm(null); setEditId(null); });
  }
  function updateStatus(book: ReadingBook, status: ReadingStatus) {
    void execute(() => api.updateBook(book.id, {
      status,
      ...(!book.startDate && status === "Reading" ? { startDate: [new Date().getFullYear(), String(new Date().getMonth() + 1).padStart(2, "0"), String(new Date().getDate()).padStart(2, "0")].join("-") } : {}),
      ...(status === "Read" ? { finishDate: new Date().toLocaleDateString("en-CA") } : {}),
    }));
  }

  return <div className="lit-page">
    <header className="lit-page-head">
      <div><span className="lit-eyebrow">PERSONAL LIBRARY</span><h1>Reading</h1>
        <p>Your existing collection, reading history and next books — shared with Personal OS.</p></div>
      <button className="lit-button is-primary" onClick={() => { setForm({ ...EMPTY }); setEditId(null); setProblem(""); }}><BookPlus size={16}/> Add book</button>
    </header>
    <div className="lit-summary">
      <div><BookOpen size={17}/><strong>{counts.current}</strong><span>reading now</span></div>
      <div><LibraryBig size={17}/><strong>{api.books.length}</strong><span>in your collection</span></div>
      <div><Quote size={17}/><strong>{api.quotes.length}</strong><span>saved quotations</span></div>
      <div><Clock3 size={17}/><strong>{minutesLabel(api.books.reduce((sum, book) => sum + bookMinutes(book), 0))}</strong><span>logged reading</span></div>
    </div>
    <div className="lit-toolbar">
      <div className="lit-tabs" role="tablist" aria-label="Reading shelves">
        {TABS.map((item) => <button role="tab" aria-selected={tab === item.id} key={item.id}
          className={tab === item.id ? "is-active" : ""} onClick={() => { setTab(item.id); setSelectedId(null); }}>
          {item.title}<span>{counts[item.id]}</span></button>)}
      </div>
      <label className="lit-search"><Search size={15}/><input placeholder="Find a book or author…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a book or author"/></label>
    </div>
    {api.loading ? <p className="lit-feedback" role="status">Opening your reading collection…</p>
      : api.error ? <div className="lit-feedback is-error" role="alert">{api.error} <button onClick={() => void api.reload()}>Retry</button></div>
      : filtered.length === 0 ? <div className="lit-empty"><BookOpen size={30}/><h2>{query ? "No matching books" : tab === "current" ? "No books in progress" : "This shelf is empty"}</h2>
          <p>{query ? "Try a different title or author." : "Choose Catalogue to see your existing books, or add a new one."}</p></div>
      : <div className="lit-book-grid">
        {filtered.map((book, index) => {
          const progress = bookProgress(book);
          return <button key={book.id} className="lit-book-card" onClick={() => openBook(book)}>
            <BookCover book={book} index={index}/>
            <div className="lit-book-description"><span className="lit-mini-label">{bookDomain(book) || book.status}</span>
              <h2>{book.title}</h2><p>{book.author || "Author not recorded"}</p>
              <div className="lit-card-bottom"><span>{minutesLabel(bookMinutes(book))} read</span><ChevronRight size={16}/></div>
              {progress ? <div className="lit-progress-bar" title={`Page ${progress.page} of ${progress.pages}`}><i style={{ width: `${progress.page / progress.pages * 100}%` }}/></div> : null}
            </div>
          </button>;
        })}
      </div>}
    {problem && !selected && !form ? <p className="lit-feedback is-error" role="alert">{problem}</p> : null}
    {selected ? <div className="lit-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <section className="lit-dialog lit-book-dialog" role="dialog" aria-modal="true" aria-label={selected.title} onKeyDown={(event) => { if (event.key === "Escape") setSelectedId(null); }}>
        <header><span className="lit-eyebrow">BOOK DETAILS</span><button className="lit-icon" onClick={() => setSelectedId(null)} aria-label="Close book details"><X size={18}/></button></header>
        <div className="lit-detail-intro"><BookCover book={selected} index={api.books.indexOf(selected)}/>
          <div><h2>{selected.title}</h2><p>{selected.author || "Author not recorded"}</p>
          <span className="lit-mini-label">{bookDomain(selected) || "Personal collection"} · Priority {selected.importance}</span></div></div>
        <label className="lit-field">Shelf status
          <select value={selected.status} disabled={busy} onChange={(event) => updateStatus(selected, event.target.value as ReadingStatus)}>
            {STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        {selected.status === "To read" ? <button className="lit-button" disabled={busy}
          onClick={() => void execute(() => api.updateBook(selected.id, { notes: notesWithShelf(selected, bookShelf(selected) === "next" ? "library" : "next") }))}>
          {bookShelf(selected) === "next" ? "Remove from Next" : "Add to Next"}
        </button> : null}
        <ReadingJournal key={selected.id} book={selected} api={api}/>
        <div className="lit-detail-stat"><Clock3 size={17}/><strong>{minutesLabel(bookMinutes(selected))}</strong><span>logged with this book</span></div>
        <div className="lit-form-row"><label className="lit-field">Add reading time (minutes)
            <input type="number" min="1" max="720" value={minutes} onChange={(event) => setMinutes(event.target.value)}/></label>
          <button className="lit-button" disabled={busy} onClick={() => void execute(() => api.logMinutes(selected, Number(minutes)))}>Log time</button></div>
        <div className="lit-form-row"><label className="lit-field">Page progress (e.g. 45/250)
            <input value={pageValue} placeholder="Page / total pages" onChange={(event) => setPageValue(event.target.value)}/></label>
          <button className="lit-button" disabled={busy} onClick={() => {
            const match = pageValue.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
            if (!match) { setProblem("Use page/total, for example 45/250."); return; }
            void execute(() => api.setProgress(selected, Number(match[1]), Number(match[2])));
          }}>Save progress</button></div>
        <div className="lit-form-actions">
          <button className="lit-button" onClick={() => { setForm({ title: selected.title, author: selected.author, status: selected.status, importance: selected.importance }); setEditId(selected.id); setSelectedId(null); }}>Edit book</button>
          <button className="lit-button" onClick={() => { onOpenQuotations(selected.id); setSelectedId(null); }}><Quote size={14}/> Open all quotations</button>
        </div>
        {problem ? <p className="lit-feedback is-error" role="alert">{problem}</p> : null}
      </section></div> : null}
    {form ? <div className="lit-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}>
      <form className="lit-dialog" role="dialog" aria-modal="true" aria-label={editId ? "Edit book" : "Add book"} onSubmit={(event) => { event.preventDefault(); saveBook(); }}>
        <header><h2>{editId ? "Edit book" : "Add to your collection"}</h2><button type="button" className="lit-icon" onClick={() => setForm(null)} aria-label="Close"><X size={18}/></button></header>
        <label className="lit-field">Title<input required autoFocus value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
        <label className="lit-field">Author<input value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })}/></label>
        <div className="lit-form-row">
          <label className="lit-field">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ReadingStatus })}>
            {STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="lit-field">Priority<select value={form.importance} onChange={(event) => setForm({ ...form, importance: Number(event.target.value) })}>
            {[1, 2, 3, 4].map((importance) => <option key={importance} value={importance}>P{importance}</option>)}</select></label>
        </div>
        {problem ? <p className="lit-feedback is-error" role="alert">{problem}</p> : null}
        <div className="lit-form-actions"><button type="button" className="lit-button" onClick={() => setForm(null)}>Cancel</button>
          <button disabled={busy || !form.title.trim()} className="lit-button is-primary" type="submit"><Plus size={15}/>{busy ? "Saving…" : editId ? "Save changes" : "Add book"}</button></div>
      </form></div> : null}
  </div>;
}
