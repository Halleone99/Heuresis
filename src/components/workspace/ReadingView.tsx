import { useMemo, useState } from "react";
import { BookOpen, BookPlus, CalendarDays, ChevronRight, Plus, Quote, Search, Users, X } from "lucide-react";
import { ReadingJournal } from "./ReadingJournal";
import { QuotationsView } from "./QuotationsView";
import {
  bookDomain, bookProgress, bookShelf, notesWithShelf, useReadingLibrary,
  type BookDraft, type ReadingBook, type ReadingStatus,
} from "../../lib/readingBridge";

type ReadingArea = "library" | "authors" | "quotations";
type Tab = "current" | "next" | "catalogue" | "archive";
const TABS: Array<{ id: Tab; title: string }> = [
  { id: "current", title: "Reading now" }, { id: "next", title: "Up next" },
  { id: "catalogue", title: "Full library" }, { id: "archive", title: "Archive" },
];
const EMPTY: BookDraft = { title: "", author: "", status: "To read", importance: 2 };
const STATUSES: ReadingStatus[] = ["To read", "Reading", "Read", "Abandoned"];
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

export function ReadingView({ userId }: { userId: string }) {
  const api = useReadingLibrary(userId);
  const [area, setArea] = useState<ReadingArea>("library");
  const [quoteSourceBookId, setQuoteSourceBookId] = useState<string | null>(null);
  const [authorQuery, setAuthorQuery] = useState("");
  const [tab, setTab] = useState<Tab>("current");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BookDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [pageValue, setPageValue] = useState("");
  const selected = api.books.find((book) => book.id === selectedId) ?? null;

  const counts: Record<Tab, number> = {
    current: api.books.filter((book) => book.status === "Reading").length,
    next: api.books.filter((book) => book.status === "To read" && bookShelf(book) === "next").length,
    catalogue: api.books.length,
    archive: api.books.filter((book) => book.status === "Read" || book.status === "Abandoned").length,
  };
  const currentYear = new Date().getFullYear();
  const finishedBooks = api.books.filter((book) => book.status === "Read");
  const finishedThisYear = finishedBooks.filter((book) => book.finishDate.slice(0, 4) === String(currentYear)).length;
  const authors = useMemo(() => {
    const byName = new Map<string, { name: string; books: ReadingBook[] }>();
    for (const book of api.books) {
      const name = book.author.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      const group = byName.get(key) ?? { name, books: [] };
      group.books.push(book); byName.set(key, group);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [api.books]);
  const visibleAuthors = authors.filter((author) => author.name.toLocaleLowerCase().includes(authorQuery.trim().toLocaleLowerCase()));
  function selectArea(next: ReadingArea) {
    setArea(next); setSelectedId(null); setForm(null); setProblem("");
    if (next === "quotations") setQuoteSourceBookId(null);
  }
  function openQuotations(bookId: string) {
    setQuoteSourceBookId(bookId); setSelectedId(null); setArea("quotations");
  }
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
    setSelectedId(book.id); setProblem("");
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

  return <div className="lit-page lit-reading-page">
    <header className="lit-page-head">
      <div><span className="lit-eyebrow">PERSONAL LIBRARY</span><h1>Reading</h1>
        <p>Your collection of books, reflections and passages — shared with Personal OS.</p></div>
    </header>
    <nav className="lit-reading-sections" aria-label="Reading sections">
      {([
        { id: "library", label: "Your library", hint: "Your collection", Icon: BookOpen },
        { id: "authors", label: "Authors", hint: "Explore authors", Icon: Users },
        { id: "quotations", label: "Quotations", hint: "Passages worth keeping", Icon: Quote },
      ] as const).map(({ id, label, hint, Icon }) =>
        <button type="button" key={id} className={area === id ? "is-active" : ""}
          aria-current={area === id ? "page" : undefined} onClick={() => selectArea(id)}>
          <Icon size={24} strokeWidth={1.6} aria-hidden="true"/>
          <span><strong>{label}</strong><small>{hint}</small></span>
        </button>)}
    </nav>
    {area === "library" ? <>
    <div className="lit-reading-overview"><div className="lit-summary">
      <div><BookOpen size={19}/><strong>{finishedBooks.length}</strong><span>total read</span></div>
      <div><CalendarDays size={19}/><strong>{finishedThisYear}</strong><span>read in {currentYear}</span></div>
    </div>
    <button className="lit-button is-primary" onClick={() => { setForm({ ...EMPTY }); setEditId(null); setProblem(""); }}><BookPlus size={16}/> Add book</button>
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
          <p>{query ? "Try a different title or author." : "Choose Full library to see your existing books, or add a new one."}</p></div>
      : <div className="lit-book-grid">
        {filtered.map((book, index) => {
          const progress = bookProgress(book);
          return <button key={book.id} className="lit-book-card" onClick={() => openBook(book)}>
            <BookCover book={book} index={index}/>
            <div className="lit-book-description"><span className="lit-mini-label">{bookDomain(book) || book.status}</span>
              <h2>{book.title}</h2><p>{book.author || "Author not recorded"}</p>
              <div className="lit-card-bottom"><span>Open book</span><ChevronRight size={16}/></div>
              {progress ? <div className="lit-progress-bar" title={`Page ${progress.page} of ${progress.pages}`}><i style={{ width: `${progress.page / progress.pages * 100}%` }}/></div> : null}
            </div>
          </button>;
        })}
      </div>}
    </> : area === "authors" ? <section className="lit-reading-authors" aria-label="Authors in your library">
      <div className="lit-toolbar">
        <div className="lit-reading-authors-title"><h2>Authors</h2><p>Browse the writers in your library.</p></div>
        <label className="lit-search"><Search size={15}/><input placeholder="Find an author…" value={authorQuery} onChange={(event) => setAuthorQuery(event.target.value)} aria-label="Find an author"/></label>
      </div>
      {api.loading ? <p className="lit-feedback" role="status">Opening your authors…</p>
        : api.error ? <div className="lit-feedback is-error" role="alert">{api.error} <button onClick={() => void api.reload()}>Retry</button></div>
        : visibleAuthors.length === 0 ? <div className="lit-empty"><Users size={30}/><h2>No matching authors</h2><p>Authors appear here when they are linked to a book in your library.</p></div>
        : <div className="lit-reading-author-grid">{visibleAuthors.map((author) =>
          <button key={author.name} type="button" className="lit-reading-author-card"
            onClick={() => { setTab("catalogue"); setQuery(author.name); setArea("library"); }}>
            <span className="lit-author-monogram" aria-hidden="true">{initials(author.name)}</span>
            <span className="lit-reading-author-info"><strong>{author.name}</strong>
              <small>{author.books.length} {author.books.length === 1 ? "book" : "books"} · {author.books.filter((book) => book.status === "Read").length} read</small>
            </span><ChevronRight size={17} aria-hidden="true"/>
          </button>)}</div>}
    </section> : <div className="lit-reading-quotes">
      <QuotationsView userId={userId} sourceBookId={quoteSourceBookId} onOpenReading={() => selectArea("library")} embedded/>
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
        <div className="lit-form-row"><label className="lit-field">Page progress (e.g. 45/250)
            <input value={pageValue} placeholder="Page / total pages" onChange={(event) => setPageValue(event.target.value)}/></label>
          <button className="lit-button" disabled={busy} onClick={() => {
            const match = pageValue.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
            if (!match) { setProblem("Use page/total, for example 45/250."); return; }
            void execute(() => api.setProgress(selected, Number(match[1]), Number(match[2])));
          }}>Save progress</button></div>
        <div className="lit-form-actions">
          <button className="lit-button" onClick={() => { setForm({ title: selected.title, author: selected.author, status: selected.status, importance: selected.importance }); setEditId(selected.id); setSelectedId(null); }}>Edit book</button>
          <button className="lit-button" onClick={() => openQuotations(selected.id)}><Quote size={14}/> Open all quotations</button>
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
