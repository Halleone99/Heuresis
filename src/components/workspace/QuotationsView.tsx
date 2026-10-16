import { useMemo, useState } from "react";
import { BookOpen, Pencil, Plus, Quote, Search, Trash2, X } from "lucide-react";
import { useReadingLibrary, type QuoteDraft, type SavedQuote } from "../../lib/readingBridge";

const EMPTY: QuoteDraft = { text: "", readingId: null, attribution: "", page: "" };
type Filter = "all" | "books" | "other";

export function QuotationsView({ userId, sourceBookId, onOpenReading }: {
  userId: string; sourceBookId: string | null; onOpenReading: () => void;
}) {
  const api = useReadingLibrary(userId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [form, setForm] = useState<QuoteDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(sourceBookId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedQuote | null>(null);

  const bookById = useMemo(() => new Map(api.books.map((book) => [book.id, book])), [api.books]);
  const sortedBooks = useMemo(() => [...api.books].sort((a, b) => a.title.localeCompare(b.title)), [api.books]);
  const visible = useMemo(() => api.quotes.filter((item) => {
    if (source && item.readingId !== source) return false;
    if (filter === "books" && !item.readingId) return false;
    if (filter === "other" && item.readingId) return false;
    const book = item.readingId ? bookById.get(item.readingId) : null;
    return [item.text, item.attribution, item.page, book?.title, book?.author].join(" ").toLowerCase().includes(query.toLowerCase().trim());
  }), [api.quotes, bookById, filter, source, query]);

  function newQuote() {
    setEditId(null); setForm({ ...EMPTY, readingId: source }); setError("");
  }
  function editQuote(quote: SavedQuote) {
    setEditId(quote.id);
    setForm({ text: quote.text, readingId: quote.readingId, attribution: quote.attribution, page: quote.page });
    setError("");
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true); setError("");
    try {
      if (editId) await api.updateQuote(editId, form);
      else await api.addQuote(form);
      setForm(null); setEditId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleteTarget || busy) return;
    setBusy(true); setError("");
    try { await api.removeQuote(deleteTarget.id); setDeleteTarget(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="lit-page">
    <header className="lit-page-head">
      <div><span className="lit-eyebrow">PASSAGES WORTH KEEPING</span><h1>Quotations</h1>
        <p>A quiet collection of words from books and beyond, independent of Study.</p></div>
      <button className="lit-button is-primary" onClick={newQuote}><Plus size={16}/> Save a quotation</button>
    </header>
    <div className="lit-quote-toolbar">
      <label className="lit-search"><Search size={15}/><input aria-label="Search quotations" placeholder="Search passages, authors, books…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <div className="lit-filter-buttons" aria-label="Quotation sources">
        {(["all", "books", "other"] as Filter[]).map((option) => <button key={option}
          className={filter === option ? "is-active" : ""} aria-pressed={filter === option} onClick={() => setFilter(option)}>
          {option === "all" ? "All" : option === "books" ? "From books" : "Other sources"}</button>)}
      </div>
    </div>
    {source ? <div className="lit-source-filter"><BookOpen size={14}/> Showing quotations from {bookById.get(source)?.title || "selected book"}
      <button onClick={() => setSource(null)}>Clear filter <X size={13}/></button></div> : null}
    {api.loading ? <p className="lit-feedback" role="status">Opening your quotations…</p>
      : api.error ? <div className="lit-feedback is-error" role="alert">{api.error} <button onClick={() => void api.reload()}>Retry</button></div>
      : visible.length ? <div className="lit-quotes-grid">{visible.map((quote) => {
        const book = quote.readingId ? bookById.get(quote.readingId) : null;
        return <article key={quote.id} className="lit-quote-card">
          <Quote className="lit-quote-mark" size={24} aria-hidden="true"/>
          <blockquote>{quote.text}</blockquote>
          <div className="lit-quote-footer">
            <div><strong>{book?.author || quote.attribution || "Unattributed"}</strong>
              {book ? <span>{book.title}</span> : quote.readingId ? <span>Book no longer in catalogue</span> : null}
              {quote.page ? <small>{quote.page}</small> : null}</div>
            <div className="lit-quote-actions">
              <button className="lit-icon" title="Edit quotation" aria-label="Edit quotation" onClick={() => editQuote(quote)}><Pencil size={15}/></button>
              <button className="lit-icon" title="Delete quotation" aria-label="Delete quotation" onClick={() => { setError(""); setDeleteTarget(quote); }}><Trash2 size={15}/></button>
            </div>
          </div>
        </article>;
      })}</div> : <div className="lit-empty"><Quote size={30}/><h2>No quotations here yet</h2><p>Save the passages you want to return to. They do not have to become flashcards.</p>
        <button className="lit-button" onClick={newQuote}>Add quotation</button></div>}
    <p className="lit-footnote">{api.quotes.length} saved quotation{api.quotes.length === 1 ? "" : "s"} · Shared with your Personal OS collection. <button onClick={onOpenReading}>Open Reading</button></p>
    {form ? <div className="lit-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setForm(null); }}>
      <form className="lit-dialog" role="dialog" aria-modal="true" aria-label={editId ? "Edit quotation" : "Add quotation"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header><h2>{editId ? "Edit quotation" : "Save a quotation"}</h2><button type="button" className="lit-icon" onClick={() => setForm(null)} aria-label="Close"><X size={18}/></button></header>
        <label className="lit-field">Passage<textarea rows={5} required autoFocus value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} placeholder="The words you want to preserve…"/></label>
        <label className="lit-field">Book (optional)
          <select value={form.readingId ?? ""} onChange={(event) => setForm({ ...form, readingId: event.target.value || null })}>
            <option value="">Other source / no linked book</option>
            {sortedBooks.map((book) => <option key={book.id} value={book.id}>{book.title} — {book.author}</option>)}
          </select>
        </label>
        <div className="lit-form-row">
          <label className="lit-field">Author or source<input value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} placeholder="Author, speaker, article…"/></label>
          <label className="lit-field">Page / reference<input value={form.page} onChange={(event) => setForm({ ...form, page: event.target.value })} placeholder="p. 42"/></label>
        </div>
        {error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
        <div className="lit-form-actions"><button type="button" className="lit-button" onClick={() => setForm(null)}>Cancel</button>
          <button type="submit" className="lit-button is-primary" disabled={busy || !form.text.trim()}>{busy ? "Saving…" : "Save quotation"}</button></div>
      </form></div> : null}
    {deleteTarget ? <div className="lit-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
      <section role="dialog" aria-modal="true" aria-label="Delete quotation" className="lit-dialog"><header><h2>Delete this quotation?</h2><button className="lit-icon" aria-label="Cancel" onClick={() => setDeleteTarget(null)}><X size={18}/></button></header>
        <p>This removes the quotation from the shared collection in Heuresis and Personal OS.</p>
        <blockquote className="lit-delete-preview">“{deleteTarget.text.slice(0, 160)}{deleteTarget.text.length > 160 ? "…" : ""}”</blockquote>
        {error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
        <div className="lit-form-actions"><button className="lit-button" onClick={() => setDeleteTarget(null)}>Keep</button>
          <button className="lit-button is-danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete quotation"}</button></div>
      </section></div> : null}
  </div>;
}
