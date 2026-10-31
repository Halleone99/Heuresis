import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, BookPlus, ChevronLeft, ChevronRight, ImagePlus, Pencil, Plus, Search, Trash2, UserRoundPlus, Users, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { ReadingBook, SavedQuote } from "../../lib/readingBridge";
import "./reading-authors.css";

const TABLE = "heuresis_reading_author_profiles";
const BUCKET = "heuresis-reading-media";
type Profile = { id: string; user_id: string; name: string; description: string; aliases: string[]; portrait_url: string | null; portrait_path: string | null };
type Group = { key: string; name: string; profile: Profile | null; books: ReadingBook[] };
type Choice = { kind: "keep" | "remove" } | { kind: "remote"; url: string } | { kind: "upload"; file: File; preview: string };
const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const monogram = (value: string) => value.trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join("");
const dateStatus = (book: ReadingBook) => book.status === "Read" ? "Finished" : book.status === "To read" ? "Want to read" : book.status;
const validImage = (file: File) => ["image/jpeg","image/png","image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024;

function Portrait({ profile, name, large = false }: { profile: Profile | null; name: string; large?: boolean }) {
  const [signed, setSigned] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false); setSigned(null);
    if (profile?.portrait_path && supabase) {
      void supabase.storage.from(BUCKET).createSignedUrl(profile.portrait_path, 3600).then(({ data }) => {
        if (active) setSigned(data?.signedUrl ?? null);
      });
    }
    return () => { active = false; };
  }, [profile?.portrait_path]);
  const src = signed || profile?.portrait_url || null;
  return <span className={"ra-portrait" + (large ? " is-large" : "")}>
    {src && !failed ? <img src={src} alt={"Portrait of " + name} loading="lazy" onError={() => setFailed(true)}/>
      : <span className="ra-monogram" aria-hidden="true">{monogram(name) || "?"}</span>}
  </span>;
}

type Candidate = { title: string; url: string };
async function findPortraits(name: string, signal: AbortSignal): Promise<Candidate[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*", generator: "search",
    gsrsearch: name, gsrnamespace: "0", gsrlimit: "6",
    prop: "pageimages", piprop: "thumbnail", pithumbsize: "800", pilicense: "free"
  });
  const response = await fetch("https://en.wikipedia.org/w/api.php?" + params, { signal });
  if (!response.ok) throw new Error("Portrait lookup is unavailable.");
  const result = await response.json() as { query?: { pages?: Array<{title?: string; thumbnail?: {source?: string}}>} };
  return (result.query?.pages ?? []).flatMap(p => p.title && p.thumbnail?.source?.startsWith("https://")
    ? [{ title: p.title, url: p.thumbnail.source }] : []);
}

async function uploadPortrait(userId: string, file: File): Promise<string> {
  if (!supabase) throw new Error("The shared database is not configured.");
  if (!validImage(file)) throw new Error("Use a JPG, PNG or WebP picture under 10 MB.");
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = userId + "/" + crypto.randomUUID() + "." + extension;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

export function ReadingAuthors({ userId, books, quotes, onOpenBook, onAddBook }: {
  userId: string; books: ReadingBook[]; quotes: SavedQuote[];
  onOpenBook: (book: ReadingBook) => void; onAddBook: (author: string) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "Reading" | "Read" | "To read" | "Abandoned">("all");
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [choice, setChoice] = useState<Choice>({ kind: "keep" });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lookupError, setLookupError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    if (!supabase) { setLoadError("The shared database is not configured."); setLoading(false); return; }
    const { data, error: cause } = await supabase.from(TABLE)
      .select("id,user_id,name,description,aliases,portrait_url,portrait_path").eq("user_id", userId).order("name");
    if (cause) setLoadError(cause.code === "42P01" || cause.code === "PGRST205"
      ? "Author profiles need the small Reading Authors database migration. Existing books are unaffected."
      : cause.message);
    else { setProfiles((data ?? []) as Profile[]); setLoadError(""); }
    setLoading(false);
  }
  useEffect(() => { void reload(); }, [userId]);
  useEffect(() => {
    const refresh = () => { if (!editing) void reload(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [userId, editing]);

  const groups = useMemo(() => {
    const items = new Map<string, Group>();
    const linked = new Map<string, string>();
    for (const profile of profiles) {
      const key = "profile:" + profile.id;
      items.set(key, { key, name: profile.name, profile, books: [] });
      for (const alias of [profile.name, ...profile.aliases]) linked.set(normalise(alias), key);
    }
    for (const book of books) {
      if (!book.author.trim()) continue;
      const key = linked.get(normalise(book.author)) ?? "author:" + normalise(book.author);
      const group = items.get(key) ?? { key, name: book.author.trim(), profile: null, books: [] };
      group.books.push(book); items.set(key, group);
    }
    return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [books, profiles]);
  const shown = groups.filter(group => normalise(group.name).includes(normalise(search)));
  const chosen = selected ? groups.find(group => group.key === selected) ?? null : null;
  const authorQuotes = (group: Group) => {
    const ids = new Set(group.books.map(book => book.id));
    return quotes.filter(quote => quote.readingId && ids.has(quote.readingId)).length;
  };

  useEffect(() => {
    if (!editing || !name.trim() || choice.kind !== "keep") { setCandidates([]); setLookupError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findPortraits(name, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          setCandidates(result); setLookupError("");
          // Use only a clearly matching Wikipedia title, never a partial-name guess.
          // The user can replace it with an upload, another result or no portrait.
          const exact = result.find(candidate => normalise(candidate.title) === normalise(name));
          const existing = typeof editing === "object" ? editing.profile : null;
          if (exact && !existing?.portrait_path && !existing?.portrait_url)
            setChoice(current => current.kind === "keep" ? { kind: "remote", url: exact.url } : current);
        }
      }).catch(() => {
        if (!controller.signal.aborted) { setCandidates([]); setLookupError("Wikipedia portraits are unavailable; upload your own if preferred."); }
      });
    }, 650);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [editing, name, choice.kind]);

  function edit(group: Group | "new") {
    setEditing(group); setError(""); setCandidates([]); setLookupError("");
    setName(group === "new" ? "" : group.name);
    setDescription(group === "new" ? "" : group.profile?.description ?? "");
    setChoice({ kind: "keep" });
  }
  function close() {
    if (choice.kind === "upload") URL.revokeObjectURL(choice.preview);
    setEditing(null); setError(""); setCandidates([]);
  }
  async function save() {
    if (!editing || busy) return;
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (!cleaned || cleaned.length > 200) { setError("Enter an author name of up to 200 characters."); return; }
    if (description.length > 1000) { setError("Keep the description below 1,000 characters."); return; }
    if (!supabase) { setError("The shared database is not configured."); return; }
    const currentProfile = editing === "new" ? null : editing.profile;
    if (groups.some(group => normalise(group.name) === normalise(cleaned) && group.key !== (editing === "new" ? "" : editing.key))) {
      setError("This author already exists. Edit the existing author instead."); return;
    }
    setBusy(true); setError("");
    try {
      let portrait_url: string | null = currentProfile?.portrait_url ?? null;
      let portrait_path: string | null = currentProfile?.portrait_path ?? null;
      if (choice.kind === "remove") { portrait_url = null; portrait_path = null; }
      if (choice.kind === "remote") { portrait_url = choice.url; portrait_path = null; }
      if (choice.kind === "upload") { portrait_path = await uploadPortrait(userId, choice.file); portrait_url = null; }
      const aliases = currentProfile ? [...new Set([...currentProfile.aliases, ...(normalise(cleaned) === normalise(currentProfile.name) ? [] : [currentProfile.name])])]
        : editing === "new" ? [] : (normalise(editing.name) === normalise(cleaned) ? [] : [editing.name]);
      const patch = { name: cleaned, description: description.trim(), portrait_url, portrait_path, aliases };
      const result = currentProfile
        ? await supabase.from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", currentProfile.id).eq("user_id", userId).select().single()
        : await supabase.from(TABLE).insert({ ...patch, user_id: userId }).select().single();
      if (result.error) throw result.error;
      const saved = result.data as Profile;
      setProfiles(previous => [...previous.filter(item => item.id !== saved.id), saved]);
      setSelected("profile:" + saved.id);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function remove(group: Group) {
    if (!group.profile || !supabase || busy) return;
    if (!window.confirm("Remove the profile for " + group.name + "? Its books and quotations will remain unchanged.")) return;
    setBusy(true); setError("");
    const { error: cause } = await supabase.from(TABLE).delete().eq("id", group.profile.id).eq("user_id", userId);
    if (cause) setError(cause.message);
    else {
      setProfiles(previous => previous.filter(profile => profile.id !== group.profile?.id));
      setSelected(group.books.length ? "author:" + normalise(group.books[0].author) : null);
      close();
    }
    setBusy(false);
  }

  const detailBooks = chosen?.books.filter(book => filter === "all" || book.status === filter)
    .sort((a, b) => a.title.localeCompare(b.title)) ?? [];

  return <section className="ra-root" aria-label="Authors">
    {chosen ? <>
      <button type="button" className="ra-back" onClick={() => { setSelected(null); setFilter("all"); }}><ChevronLeft size={16}/> All authors</button>
      <header className="ra-profile">
        <Portrait profile={chosen.profile} name={chosen.name} large/>
        <div className="ra-profile-copy">
          <h2>{chosen.name}</h2>
          {chosen.profile?.description ? <p className="ra-description">{chosen.profile.description}</p> : null}
          <p>{chosen.books.length} {chosen.books.length === 1 ? "book" : "books"} · {chosen.books.filter(b => b.status === "Read").length} finished · {chosen.books.filter(b => b.status === "Reading").length} in progress{authorQuotes(chosen) ? " · " + authorQuotes(chosen) + " linked quotations" : ""}</p>
          <div className="ra-actions">
            <button type="button" className="lit-button is-primary" onClick={() => onAddBook(chosen.name)}><BookPlus size={15}/> Add book</button>
            <button type="button" className="lit-button" onClick={() => edit(chosen)}><Pencil size={14}/> {chosen.profile ? "Edit author" : "Add author details"}</button>
          </div>
        </div>
      </header>
      <div className="ra-section-bar">
        <h3>Books</h3>
        <div className="ra-filters" role="group" aria-label="Filter books by status">
          {([["all","All"],["To read","Want to read"],["Reading","Reading"],["Read","Finished"],["Abandoned","Abandoned"]] as const).map(([key,label]) =>
            <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-on" : ""} onClick={() => setFilter(key)}>
              {label} <span>{key === "all" ? chosen.books.length : chosen.books.filter(b=>b.status === key).length}</span>
            </button>)}
        </div>
      </div>
      {detailBooks.length ? <div className="ra-books">{detailBooks.map((book, i) =>
        <button type="button" className="ra-book" key={book.id} onClick={() => onOpenBook(book)}>
          <span className="ra-book-cover" data-tone={i%5}><span>{book.title}</span><small>{book.author}</small></span>
          <span className="ra-book-title">{book.title}</span><small>{dateStatus(book)}</small>
          {book.finishDate ? <small>Finished {book.finishDate}</small> : null}
        </button>)}</div> : <p className="ra-empty">No books in this category.</p>}
    </> : <>
      <div className="ra-heading">
        <div><h2>Authors</h2><p>The writers behind the books in your library.</p></div>
        <button className="lit-button is-primary" onClick={() => edit("new")} disabled={Boolean(loadError)}><UserRoundPlus size={16}/> Add author</button>
      </div>
      {loadError ? <p className="lit-feedback is-error" role="alert">{loadError}</p> : null}
      <label className="lit-search ra-search"><Search size={16}/><input placeholder="Search authors…" aria-label="Search authors" value={search} onChange={e => setSearch(e.target.value)}/></label>
      {loading && !groups.length ? <p className="lit-feedback">Opening author profiles…</p> : shown.length ? <div className="ra-grid">
        {shown.map(group => <button type="button" className="ra-author-card" key={group.key} onClick={() => setSelected(group.key)}>
          <Portrait profile={group.profile} name={group.name}/>
          <span className="ra-card-body">
            <span className="ra-card-title">{group.name}<ChevronRight size={17}/></span>
            {group.profile?.description ? <span className="ra-card-description">{group.profile.description}</span> : null}
            <span className="ra-card-counts">{group.books.length} {group.books.length === 1 ? "book" : "books"}, {group.books.filter(b=>b.status==="Read").length} finished
              {authorQuotes(group) ? " · " + authorQuotes(group) + " quotations" : ""}</span>
          </span>
        </button>)}
        {!search.trim() && !loadError ? <button type="button" className="ra-add-card" onClick={() => edit("new")}><Plus size={20}/><strong>Add author</strong><small>Add a writer without adding a book first.</small></button> : null}
      </div> : <p className="ra-empty">{search ? "No matching authors." : "Authors will appear here from your existing books. You can add a profile independently."}</p>}
    </>}
    {editing ? <div className="lit-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
      <form className="lit-dialog ra-dialog" role="dialog" aria-modal="true" aria-label={editing === "new" ? "Add author" : "Edit author"} onSubmit={event => { event.preventDefault(); void save(); }}>
        <header><h2>{editing === "new" ? "Add author" : "Edit author"}</h2><button type="button" className="lit-icon" aria-label="Close" onClick={close} disabled={busy}><X size={18}/></button></header>
        <label className="lit-field">Author name<input required maxLength={200} autoFocus value={name} onChange={event => setName(event.target.value)}/></label>
        <label className="lit-field">Short description (optional)<input maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Philosophy, absurdism, literature"/></label>
        <div className="ra-picker">
          <label>Portrait (optional)</label>
          <div className="ra-picker-options">
            {choice.kind === "upload" ? <img src={choice.preview} alt="Portrait preview"/> : choice.kind === "remote" ? <img src={choice.url} alt="Selected portrait"/>
              : choice.kind === "keep" && editing !== "new" ? <Portrait profile={editing.profile} name={name}/> : <span className="ra-monogram">{monogram(name) || "?"}</span>}
            <div className="ra-picker-controls">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
                const file = event.target.files?.[0]; if (!file) return;
                if (!validImage(file)) { setError("Choose a JPG, PNG or WebP portrait under 10 MB."); return; }
                if (choice.kind === "upload") URL.revokeObjectURL(choice.preview);
                setChoice({ kind: "upload", file, preview: URL.createObjectURL(file) });
                event.target.value = "";
              }}/>
              <button type="button" className="lit-button" onClick={() => fileRef.current?.click()}><ImagePlus size={15}/> Upload picture</button>
              <button type="button" className="lit-button" onClick={() => { if (choice.kind === "upload") URL.revokeObjectURL(choice.preview); setChoice({kind:"remove"}); }}>Remove</button>
              {choice.kind === "keep" && candidates.length ? <div className="ra-candidates">{candidates.map(candidate =>
                <button key={candidate.url} type="button" title={candidate.title} aria-label={"Use Wikipedia portrait " + candidate.title} onClick={() => setChoice({kind:"remote",url:candidate.url})}><img src={candidate.url} alt={candidate.title}/></button>)}</div> : null}
              {choice.kind === "keep" && lookupError ? <small>{lookupError}</small> : null}
              {choice.kind === "keep" && !lookupError && !candidates.length ? <small>Wikipedia portraits are suggested when available.</small> : null}
            </div>
          </div>
        </div>
        {editing !== "new" && editing.profile ? <p className="ra-note">Removing this profile will not remove or change its books or quotations.</p> : null}
        {error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
        <div className="lit-form-actions">
          {editing !== "new" && editing.profile ? <button type="button" className="lit-button ra-danger" disabled={busy} onClick={() => void remove(editing)}><Trash2 size={14}/> Remove profile</button> : null}
          <button type="button" className="lit-button" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="lit-button is-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save author"}</button>
        </div>
      </form>
    </div> : null}
  </section>;
}
