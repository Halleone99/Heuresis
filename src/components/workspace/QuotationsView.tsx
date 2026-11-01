import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Pencil, Plus, Quote, Search, Trash2, X } from "lucide-react";
import { useReadingLibrary, type QuoteDraft, type ReadingBook, type SavedQuote } from "../../lib/readingBridge";

import "./quotation-collections.css";

const EMPTY: QuoteDraft = { text: "", readingId: null, attribution: "", page: "" };
type QuoteCollection = {
  key: string;
  title: string;
  subtitle: string;
  kind: "book" | "other" | "author";
  sourceAttribution: string;
  readingId: string | null;
  quotes: SavedQuote[];
};

/** Group by actual book ID, or by the cited source when the passage has no linked book.
 * Existing Personal OS quotes frequently store "Author, Work — note" in attribution. */
function citedSource(attribution: string) {
  return attribution.split(/\s+[—–]\s+/)[0].trim();
}
function citationNote(attribution: string) {
  return attribution.split(/\s+[—–]\s+/).slice(1).join(" — ").trim();
}
function sourceParts(source: string) {
  const comma = source.indexOf(", ");
  return comma > 0 ? { title: source.slice(comma + 2).trim(), author: source.slice(0, comma).trim() }
    : { title: source || "Unattributed", author: source ? "Other source" : "Without attribution" };
}
/** Resolve author from an actual linked book first, then from legacy "Author, Work" attributions. */
function quoteAuthor(quote: SavedQuote, books: Map<string, ReadingBook>) {
  const linked = quote.readingId ? books.get(quote.readingId) : null;
  if (linked?.author.trim()) return linked.author.trim();
  const source = citedSource(quote.attribution);
  return source.includes(", ") ? sourceParts(source).author : source || "Unknown author";
}
function workTitle(quote: SavedQuote, books: Map<string, ReadingBook>) {
  const linked = quote.readingId ? books.get(quote.readingId) : null;
  if (linked) return linked.title;
  const source = citedSource(quote.attribution);
  return source.includes(", ") ? sourceParts(source).title : "Other source";
}
function quoteCount(count: number) {
  return count + (count === 1 ? " quotation" : " quotations");
}

export function QuotationsView({ userId, sourceBookId, onOpenReading, embedded = false }: {
  userId: string; sourceBookId: string | null; onOpenReading: () => void; embedded?: boolean;
}) {
  const api = useReadingLibrary(userId);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"author" | "book">("book");
  const [selectedKey, setSelectedKey] = useState<string | null>(sourceBookId ? "book:" + sourceBookId : null);
  const [lastCollection, setLastCollection] = useState<QuoteCollection | null>(null);
  const [form, setForm] = useState<QuoteDraft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  useEffect(() => { if (sourceBookId) setViewMode("book"); setSelectedKey(sourceBookId ? "book:" + sourceBookId : null); }, [sourceBookId]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedQuote | null>(null);

  const bookById = useMemo(() => new Map(api.books.map((book) => [book.id, book])), [api.books]);
  const sortedBooks = useMemo(() => [...api.books].sort((a, b) => a.title.localeCompare(b.title)), [api.books]);
  const collections = useMemo(() => {
    const bySource = new Map<string, QuoteCollection>();
    for (const quote of api.quotes) {
      const book = quote.readingId ? bookById.get(quote.readingId) : null;
      const source = citedSource(quote.attribution);
      const named = sourceParts(source);
      const key = quote.readingId ? "book:" + quote.readingId : "source:" + source.toLocaleLowerCase();
      if (!bySource.has(key)) {
        bySource.set(key, {
          key,
          title: quote.readingId ? book?.title || "Book no longer in catalogue" : named.title,
          subtitle: quote.readingId ? book?.author || "From your reading catalogue" : named.author,
          kind: quote.readingId ? "book" : "other",
          readingId: quote.readingId,
          sourceAttribution: source,
          quotes: [],
        });
      }
      bySource.get(key)!.quotes.push(quote);
    }
    return [...bySource.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [api.quotes, bookById]);
  const authorCollections = useMemo(() => {
    const grouped = new Map<string, QuoteCollection>();
    for (const quote of api.quotes) {
      const author = quoteAuthor(quote, bookById);
      const key = "author:" + author.toLocaleLowerCase().replace(/\s+/g, " ").trim();
      if (!grouped.has(key)) grouped.set(key, {
        key, title: author, subtitle: "", kind: "author",
        sourceAttribution: author, readingId: null, quotes: [],
      });
      grouped.get(key)!.quotes.push(quote);
    }
    return [...grouped.values()].map((group) => {
      const sourceCount = new Set(group.quotes.map((quote) =>
        quote.readingId ? "book:" + quote.readingId : "source:" + citedSource(quote.attribution).toLocaleLowerCase())).size;
      return { ...group, subtitle: sourceCount + (sourceCount === 1 ? " source" : " sources") };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [api.quotes, bookById]);
  const activeCollections = viewMode === "author" ? authorCollections : collections;
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const found = activeCollections.find((item) => item.key === selectedKey);
    if (found) return found;
    if (lastCollection?.key === selectedKey) return { ...lastCollection, quotes: [] };
    if (selectedKey.startsWith("book:")) {
      const id = selectedKey.slice(5);
      const book = bookById.get(id);
      if (book) return { key: selectedKey, title: book.title, subtitle: book.author, kind: "book" as const, readingId: id, sourceAttribution: "", quotes: [] };
    }
    return null;
  }, [selectedKey, activeCollections, lastCollection, bookById]);
  const normalisedQuery = query.trim().toLocaleLowerCase();
  const matchesQuote = (quote: SavedQuote) => [quote.text, quote.attribution, quote.page]
    .join(" ").toLocaleLowerCase().includes(normalisedQuery);
  const visibleCollections = activeCollections.filter((collection) =>
    !normalisedQuery || [collection.title, collection.subtitle].join(" ").toLocaleLowerCase().includes(normalisedQuery)
      || collection.quotes.some(matchesQuote));
  const visibleQuotes = selected ? selected.quotes.filter(matchesQuote) : [];
  function openCollection(collection: QuoteCollection) {
    setLastCollection(collection);
    setSelectedKey(collection.key);
    setQuery("");
  }
  function goHome() { setSelectedKey(null); setQuery(""); }
  function changeView(next: "author" | "book") {
    if (next === viewMode) return;
    setViewMode(next); setSelectedKey(null); setLastCollection(null); setQuery("");
  }

  function newQuote() {
    setEditId(null);
    setForm({
      ...EMPTY,
      readingId: selected?.readingId ?? null,
      attribution: selected?.kind === "other" || selected?.kind === "author" ? selected.sourceAttribution : "",
    });
    setError("");
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

  return <div className="lit-page lit-quotation-page">
    {!embedded ? <header className="lit-page-head lit-quotation-page-head">
      <div><h1>Quotations</h1></div>
      <div className="lit-quote-head-aside">
        <span className="lit-quote-total-inline">{api.quotes.length} {api.quotes.length === 1 ? "passage" : "passages"}</span>
        <button className="lit-button is-primary" onClick={newQuote}><Plus size={16}/> Add quotation</button>
      </div>
    </header> : null}
    {selectedKey ? <div className="lit-quote-detail-topbar">
      <nav className="lit-quote-breadcrumb" aria-label="Quotation navigation">
        <button type="button" onClick={goHome}><ArrowLeft size={15}/> {viewMode === "author" ? "All authors" : "All sources"}</button>
        <span aria-hidden="true">/</span>
        <strong>{selected?.title || "Source"}</strong>
      </nav>
      <button type="button" className="lit-button is-primary" onClick={newQuote}><Plus size={16}/> Add quotation</button>
    </div> : null}
    {api.loading ? <p className="lit-feedback" role="status">Opening your quotations…</p>
      : api.error ? <div className="lit-feedback is-error" role="alert">{api.error} <button onClick={() => void api.reload()}>Retry</button></div>
      : selected ? <>
        <div className="lit-quote-source-heading">
          <div className="lit-quote-source-meta">{selected.kind === "author" ? "BY AUTHOR" : selected.kind === "book" ? "FROM YOUR LIBRARY" : "OTHER SOURCES"} <span>·</span> {quoteCount(selected.quotes.length)}</div>
          <h2>{selected.title}</h2>
          <p>{selected.subtitle || "Source not recorded"}</p>
        </div>
        <div className="lit-quotation-search-row">
          <label className="lit-search"><Search size={15}/><input aria-label="Search quotations in this source"
            placeholder="Search these passages…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        </div>
        {visibleQuotes.length ? <div className="lit-quote-reading-list">{visibleQuotes.map((quote, index) => {
          const note = citationNote(quote.attribution);
          const authorView = selected.kind === "author";
          return <article className="lit-quote-reading-entry" key={quote.id}>
            <div className="lit-quote-entry-number">{String(index + 1).padStart(2, "0")}</div>
            <div className="lit-quote-entry-body">
              <Quote size={20} strokeWidth={1.4} className="lit-quote-entry-mark" aria-hidden="true"/>
              <blockquote>{quote.text}</blockquote>
              <footer>
                <div className="lit-quote-citation">
                  <strong>{authorView ? selected.title : selected.subtitle !== "Other source" && selected.subtitle !== "Without attribution"
                    ? selected.subtitle : selected.title}</strong>
                  <span>{authorView ? workTitle(quote, bookById) : selected.title}{quote.page ? " · " + quote.page : ""}</span>
                  {note ? <p>{note}</p> : null}
                </div>
                <div className="lit-quote-actions">
                  <button type="button" className="lit-icon" title="Edit quotation" aria-label="Edit quotation" onClick={() => editQuote(quote)}><Pencil size={15}/></button>
                  <button type="button" className="lit-icon" title="Delete quotation" aria-label="Delete quotation" onClick={() => { setError(""); setDeleteTarget(quote); }}><Trash2 size={15}/></button>
                </div>
              </footer>
            </div>
          </article>;
        })}</div> : <div className="lit-empty"><Quote size={25}/><h2>{normalisedQuery ? "No matching passages" : "No quotations from this source yet"}</h2>
          <p>{normalisedQuery ? "Try a different search." : "Save the first passage in this collection."}</p>
          {!normalisedQuery ? <button className="lit-button" onClick={newQuote}>Add quotation</button> : null}
        </div>}
      </> : <>
        <div className="lit-quote-opening-controls">
          <label className="lit-search"><Search size={16}/><input aria-label="Search quotations and sources"
            placeholder="Search passages, books or authors…" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
          <div className="lit-quote-grouping" role="group" aria-label="Group quotations by">
            <button type="button" className={viewMode === "book" ? "is-active" : ""} aria-pressed={viewMode === "book"} onClick={() => changeView("book")}>Source</button>
            <button type="button" className={viewMode === "author" ? "is-active" : ""} aria-pressed={viewMode === "author"} onClick={() => changeView("author")}>Author</button>
          </div>
          <span className="lit-quote-total-inline">{api.quotes.length} {api.quotes.length === 1 ? "passage" : "passages"}</span>
          <button type="button" className="lit-button is-primary" onClick={newQuote}><Plus size={16}/> Add quotation</button>
        </div>
        {api.quotes.length === 0 ? <div className="lit-empty"><Quote size={27}/><h2>No quotations yet</h2>
          <p>Save a passage from a book, or record words from another source.</p>
          <button className="lit-button" onClick={newQuote}>Add quotation</button></div>
          : visibleCollections.length === 0 ? <div className="lit-empty"><Search size={25}/><h2>No matching sources</h2>
              <p>Try searching for a different author, book or passage.</p></div>
          : <section className="lit-quote-collection-groups" aria-label={viewMode === "author" ? "Quotation authors" : "Quotation sources"}>
            <div className="lit-quote-section-heading">
              <h2>{viewMode === "author" ? "Authors" : "Sources"} <span>({visibleCollections.length})</span></h2>
            </div>
            <div className="lit-quote-collections-grid">
              {visibleCollections.map((collection) =>
                <button type="button" key={collection.key} className="lit-quote-collection-card"
                  onClick={() => openCollection(collection)} aria-label={collection.title + ", " + quoteCount(collection.quotes.length)}>
                  <span className="lit-quote-collection-title">{collection.title}</span>
                  <span className="lit-quote-collection-author">{collection.subtitle}</span>
                  <span className="lit-quote-collection-foot">
                    <span>{quoteCount(collection.quotes.length)}</span>
                    <ArrowUpRight size={16} strokeWidth={1.6} aria-hidden="true"/>
                  </span>
                </button>
              )}
            </div>
          </section>}
      </>}
    {!embedded ? <p className="lit-footnote">Shared with your Personal OS reading collection. <button onClick={onOpenReading}>Open Reading</button></p> : null}
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
