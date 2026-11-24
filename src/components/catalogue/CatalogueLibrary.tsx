import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookMarked, BookOpen, ChevronRight, FileDown, FolderPlus, ImagePlus,
  LayoutGrid, List, Pencil, Plus, RotateCcw, Search, Trash2, X,
} from "lucide-react";
import {
  articleText, articleTitle, LIMITS, normaliseSearch, sortArticles,
  type CatalogueArticle, type CatalogueSubject, type ImageRef,
} from "../../lib/catalogue/model";
import { catalogueError } from "../../lib/catalogue/store";
import { attributionLine } from "../../lib/catalogue/wikimedia";
import { useConfirm } from "../workspace/ui";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ImageFrame } from "./ArticlePage";
import { useCatalogue, type CatalogueShelfRoute } from "./CatalogueData";
import { CreateArticleDialog } from "./CreateArticleDialog";
import { ExportDialog } from "./ExportDialog";
import { ImageDialog } from "./ImageDialog";
import { Dialog, Field, Menu, PageThumb, formatDate } from "./parts";
import { VolumeDialog } from "./VolumeView";

const ILLUSTRATION_ASPECT = 16 / 9;
type ArticleView = "grid" | "list";
type StatusFilter = "all" | "published" | "draft";
type SortOrder = "recent" | "oldest" | "title";
type LibraryRoute = Exclude<CatalogueShelfRoute, { view: "volume" }>;

function articleCount(count: number) {
  return `${count} ${count === 1 ? "article" : "articles"}`;
}

function CollectionIllustration({ illustration }: { illustration: ImageRef | null }) {
  return <span className="ct-collection-art">
    {illustration ? <ImageFrame image={illustration} aspect={ILLUSTRATION_ASPECT} />
      : <span className="ct-bookplate" aria-hidden="true"><BookOpen size={40} strokeWidth={1} /></span>}
  </span>;
}

function CollectionDialog({ subject, onClose }: { subject: CatalogueSubject | null; onClose: () => void }) {
  const catalogue = useCatalogue();
  const [name, setName] = useState(subject?.name ?? "");
  const [description, setDescription] = useState(subject?.description ?? "");
  const [illustration, setIllustration] = useState(subject?.illustration ?? null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (subject) {
        await catalogue.changeSubject(subject, {
          ...(name.trim() !== subject.name ? { name } : {}),
          ...(description.trim() !== subject.description ? { description } : {}),
          ...(illustration !== subject.illustration ? { illustration } : {}),
        });
      } else {
        const created = await catalogue.addSubject(name, { description, illustration });
        catalogue.navigate({ view: "collection", id: created.id });
      }
      onClose();
    } catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(false); }
  }

  return <Dialog title={subject ? "Edit collection" : "New collection"} wide onClose={() => { if (!busy) onClose(); }}
    actions={<>
      <button type="button" className="ws-button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="submit" form="ct-collection-form" className="ws-button is-primary" disabled={!name.trim() || busy}>
        {subject ? "Save collection" : "Create collection"}
      </button>
    </>}>
    <form id="ct-collection-form" className="ct-collection-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="ct-collection-fields">
        <Field label="Name"><input autoFocus maxLength={LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Description (optional)">
          <textarea rows={4} maxLength={LIMITS.subtitle} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </div>
      <div className="ct-collection-image-field">
        <button type="button" className="ct-illustration-pick" onClick={() => setChoosing(true)}
          aria-label={illustration ? "Edit illustration" : "Choose illustration"}>
          {illustration ? <CollectionIllustration illustration={illustration} /> : <span><ImagePlus size={20} /> Choose illustration</span>}
        </button>
        {illustration ? <button type="button" className="ws-button is-small is-quiet" onClick={() => setIllustration(null)}><X size={13} /> Remove illustration</button> : null}
      </div>
    </form>
    {error ? <p className="ct-error" role="alert">{error}</p> : null}
    {choosing ? <ImageDialog initial={illustration} lockedAspect={ILLUSTRATION_ASPECT} title="Collection illustration"
      onClose={() => setChoosing(false)} onApply={(image) => { setIllustration(image); setChoosing(false); }} /> : null}
  </Dialog>;
}

function DeletedDialog({ onClose }: { onClose: () => void }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  return <Dialog title="Deleted articles" onClose={onClose} wide>
    {confirmElement}
    {catalogue.deleted.length ? <ul className="ct-deleted">
      {catalogue.deleted.map((article) => <li key={article.id}>
        <span><strong>{articleTitle(article)}</strong><small>Last edited {formatDate(article.updated_at)}</small></span>
        <button type="button" className="ws-button is-small" onClick={() => void catalogue.restoreArticle(article).then(() => workspace.toast("Article restored."))
          .catch((cause) => workspace.toast(catalogueError(cause), { tone: "error" }))}><RotateCcw size={13} /> Restore</button>
        <button type="button" className="ws-button is-small is-quiet" onClick={() => void (async () => {
          if (!await confirm({ title: "Delete permanently?", body: "This article will be removed from the Catalogue for good. Notebook notes are not affected.", confirmLabel: "Delete permanently", danger: true })) return;
          try { await catalogue.purgeArticle(article); workspace.toast("Article deleted permanently."); }
          catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
        })()}><Trash2 size={13} /> Delete</button>
      </li>)}
    </ul> : <p className="ws-muted">No deleted articles.</p>}
  </Dialog>;
}

function ArticleSearch({ onClose }: { onClose: () => void }) {
  const catalogue = useCatalogue();
  const [query, setQuery] = useState("");
  const search = normaliseSearch(query);
  const matches = useMemo(() => {
    if (!search) return [];
    return sortArticles(catalogue.snapshot.articles.filter((article) => normaliseSearch([
      articleText(article),
      article.subject_id ? catalogue.subjectById.get(article.subject_id)?.name : "",
      article.volume_id ? catalogue.volumeById.get(article.volume_id)?.title : "",
    ].join(" ")).includes(search)));
  }, [catalogue.snapshot.articles, catalogue.subjectById, catalogue.volumeById, search]);

  return <Dialog title="Search the Catalogue" onClose={onClose} wide>
    <label className="ct-search"><Search size={15} aria-hidden="true" />
      <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder="Find an article in any collection…" aria-label="Find an article in any collection" />
    </label>
    {matches.length ? <ul className="ct-note-list" aria-label="Article results">
      {matches.map((article) => {
        const subject = article.subject_id ? catalogue.subjectById.get(article.subject_id) : null;
        return <li key={article.id}><button type="button" onClick={() => {
          onClose();
          catalogue.navigate({ view: article.status === "draft" ? "design" : "read", id: article.id, from: { view: "library" } });
        }}>
          <strong>{articleTitle(article)}</strong>
          <small>{subject?.name ?? "Independent articles"}{article.status === "draft" ? " · Draft" : ""}</small>
        </button></li>;
      })}
    </ul> : search ? <p className="ct-quiet ct-collection-empty" role="status">No matching articles.</p> : null}
  </Dialog>;
}

function ArticleEntry({ article, view, from, onDelete, onExport }: {
  article: CatalogueArticle; view: ArticleView; from: LibraryRoute; onDelete: () => void; onExport: () => void;
}) {
  const catalogue = useCatalogue();
  const title = articleTitle(article);
  const draft = article.status === "draft";
  const volume = article.volume_id ? catalogue.volumeById.get(article.volume_id) : null;
  const edit = () => catalogue.navigate({ view: "design", id: article.id, from });
  const read = () => catalogue.navigate({ view: "read", id: article.id, from });
  const labels = catalogue.labelFor(article);

  return <article className="ct-index-entry">
    <button type="button" className="ct-index-open" onClick={draft ? edit : read} aria-label={`${draft ? "Edit draft" : "Read"} ${title}`}>
      {view === "grid" ? <span className="ct-index-cover" aria-hidden="true">
        {article.cover ? <ImageFrame image={article.cover} aspect={1 / Math.SQRT2} />
          : <PageThumb article={article} page={article.pages[0]} pageIndex={0} width={210} {...labels} />}
      </span> : null}
      <span className="ct-index-copy">
        <strong>{title}</strong>
        {article.subtitle ? <span className="ct-index-subtitle">{article.subtitle}</span> : null}
        <span className="ct-index-meta">
          {draft ? <em>Draft</em> : null}
          {volume ? <span>{volume.title}</span> : null}
          <span>{formatDate(draft ? article.updated_at : article.published_at ?? article.updated_at)}</span>
        </span>
      </span>
    </button>
    <Menu label={`Actions for ${title}`} items={[
      { label: draft ? "Edit draft" : "Edit article", icon: <Pencil size={14} />, run: edit },
      { label: "Export PDF", icon: <FileDown size={14} />, run: onExport },
      "divider",
      { label: "Move to deleted articles", icon: <Trash2 size={14} />, danger: true, run: onDelete },
    ]} />
  </article>;
}

export function CatalogueLibrary({ route }: { route: LibraryRoute }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const { snapshot } = catalogue;
  const home = route.view === "library";
  const subjectId = route.view === "collection" ? route.id : null;
  const subject = subjectId ? catalogue.subjectById.get(subjectId) : null;
  const [creating, setCreating] = useState(false);
  const [collectionDialog, setCollectionDialog] = useState<{ subject: CatalogueSubject | null } | null>(null);
  const [creatingVolume, setCreatingVolume] = useState(false);
  const [searching, setSearching] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [exporting, setExporting] = useState<CatalogueArticle | null>(null);
  const [confirmElement, confirm] = useConfirm();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [order, setOrder] = useState<SortOrder>("recent");
  const viewKey = `heuresis.catalogue.article-view.v1:${catalogue.userId}`;
  const [view, setView] = useState<ArticleView>(() => {
    try { return localStorage.getItem(viewKey) === "list" ? "list" : "grid"; }
    catch { return "grid"; }
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!home) heading.current?.focus({ preventScroll: true }); }, [home]);

  const counts = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const article of snapshot.articles) counts.set(article.subject_id, (counts.get(article.subject_id) ?? 0) + 1);
    return counts;
  }, [snapshot.articles]);

  const count = counts.get(subjectId) ?? 0;
  const search = normaliseSearch(query);
  const matches = useMemo(() => {
    if (home) return [];
    const articles = sortArticles(snapshot.articles.filter((article) =>
      article.subject_id === subjectId && (status === "all" || status === article.status)
      && (!search || normaliseSearch(`${articleText(article)} ${catalogue.volumeById.get(article.volume_id ?? "")?.title ?? ""}`).includes(search))));
    if (order === "title") return articles.sort((a, b) => articleTitle(a).localeCompare(articleTitle(b), undefined, { sensitivity: "base" }));
    return order === "oldest" ? articles.reverse() : articles;
  }, [catalogue.volumeById, home, order, search, snapshot.articles, status, subjectId]);

  const volumes = snapshot.volumes.filter((volume) => volume.subject_id === subjectId)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  const landing = { view: "library" } as const;

  function changeView(next: ArticleView) {
    setView(next);
    try { localStorage.setItem(viewKey, next); } catch { /* optional preference */ }
  }

  async function deleteCollection(collection: CatalogueSubject) {
    if (!await confirm({
      title: `Delete “${collection.name}”?`, body: "Its articles and volumes will remain accessible under Independent articles.",
      confirmLabel: "Delete collection", danger: true,
    })) return;
    try {
      await catalogue.removeSubject(collection.id);
      catalogue.returnTo(landing);
      workspace.toast("Collection deleted. Its articles and volumes are kept.");
    } catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
  }

  async function deleteArticle(article: CatalogueArticle) {
    if (!await confirm({
      title: `Delete “${articleTitle(article)}”?`, body: "You can restore it from Deleted articles.",
      confirmLabel: "Delete article", danger: true,
    })) return;
    try { await catalogue.removeArticle(article); }
    catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
  }

  if (subjectId && !subject) return <div className="ct-library">
    <p className="ct-quiet">This collection is no longer available.</p>
    <button type="button" className="ws-button" onClick={() => catalogue.returnTo(landing)}>Back to Catalogue</button>
  </div>;

  const actions = <div className="ct-masthead-actions">
    {home ? <button type="button" className="ws-icon-button ct-catalogue-search" aria-label="Search the Catalogue"
      onClick={() => setSearching(true)}><Search size={17} /></button> : null}
    <button type="button" className="ct-create" onClick={() => setCreating(true)}><Plus size={15} /> New article</button>
    <Menu label={subject ? "Collection actions" : home ? "Catalogue actions" : "Independent article actions"} items={[
      ...(subject ? [{ label: "Edit collection", icon: <Pencil size={14} />, run: () => setCollectionDialog({ subject }) }] : []),
      ...(home ? [{ label: "New collection", icon: <FolderPlus size={14} />, run: () => setCollectionDialog({ subject: null }) }] : []),
      { label: "New volume", icon: <BookMarked size={14} />, run: () => setCreatingVolume(true) },
      ...(subject ? ["divider" as const, { label: "Delete collection", icon: <Trash2 size={14} />, danger: true, run: () => void deleteCollection(subject) }] : []),
      ...(home ? ["divider" as const, { label: "Deleted articles", icon: <Trash2 size={14} />, run: () => setDeletedOpen(true) }] : []),
    ]} />
  </div>;
  const back = <nav className="ct-crumbs" aria-label="Catalogue navigation">
    <button type="button" onClick={() => catalogue.returnTo(landing)}><ArrowLeft size={15} /> Catalogue</button>
  </nav>;
  const credit = attributionLine(subject?.illustration?.attribution);

  return <div className={`ct-library ${home ? "ct-collection-index" : "ct-collection-page"}`}>
    {confirmElement}
    {creating ? <CreateArticleDialog onClose={() => setCreating(false)} defaultSubjectId={subjectId} /> : null}
    {collectionDialog ? <CollectionDialog subject={collectionDialog.subject} onClose={() => setCollectionDialog(null)} /> : null}
    {creatingVolume ? <VolumeDialog volume={null} subjectId={subjectId} onClose={() => setCreatingVolume(false)}
      onSaved={(volume) => catalogue.navigate({ view: "volume", id: volume.id })} /> : null}
    {searching ? <ArticleSearch onClose={() => setSearching(false)} /> : null}
    {deletedOpen ? <DeletedDialog onClose={() => setDeletedOpen(false)} /> : null}
    {exporting ? <ExportDialog articles={[exporting]} title={articleTitle(exporting)} onClose={() => setExporting(null)} /> : null}

    {home ? <>
      <header className="ct-masthead">
        <h1>Catalogue</h1>
        {actions}
      </header>
      {snapshot.subjects.length ? <div className="ct-collection-cards">
        {snapshot.subjects.map((collection) => <button key={collection.id} type="button" className="ct-collection-card"
          onClick={() => catalogue.navigate({ view: "collection", id: collection.id })}>
          <CollectionIllustration illustration={collection.illustration} />
          <span className="ct-collection-card-copy">
            <strong>{collection.name}</strong>
            {collection.description ? <span className="ct-collection-description">{collection.description}</span> : null}
            <span className="ct-collection-card-foot"><span>{articleCount(counts.get(collection.id) ?? 0)}</span><ArrowRight size={18} aria-hidden="true" /></span>
          </span>
        </button>)}
      </div> : <div className="ct-collection-empty">
        <p className="ct-quiet">No collections yet.</p>
        <button type="button" className="ct-link" onClick={() => setCollectionDialog({ subject: null })}>Create a collection</button>
      </div>}
      {count || volumes.length ? <button type="button" className="ct-independent" onClick={() => catalogue.navigate({ view: "independent" })}>
        <span>Independent articles</span><small>{articleCount(count)}</small><ChevronRight size={16} aria-hidden="true" />
      </button> : null}
    </> : <>
      {back}
      <header className="ct-collection-head">
        <div className="ct-collection-intro">
          <h1 ref={heading} tabIndex={-1}>{subject?.name ?? "Independent articles"}</h1>
          {subject?.description ? <p className="ct-collection-description">{subject.description}</p> : null}
          <span className="ct-collection-count">{articleCount(count)}</span>
        </div>
        {subject ? <figure className="ct-collection-feature">
          <CollectionIllustration illustration={subject.illustration} />
          {credit ? <figcaption>{credit}</figcaption> : null}
        </figure> : null}
      </header>
      <section className="ct-article-index" aria-labelledby="ct-articles">
        <div className="ct-index-head"><h2 id="ct-articles">Articles</h2>{actions}</div>
        {count ? <div className="ct-toolbar" role="search" aria-label="Search articles">
          <label className="ct-search"><Search size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an article…" aria-label="Find an article" />
          </label>
          <select aria-label="Publication status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">All articles</option><option value="draft">Drafts</option><option value="published">Published</option>
          </select>
          <select aria-label="Sort articles" value={order} onChange={(event) => setOrder(event.target.value as SortOrder)}>
            <option value="recent">Latest edits</option><option value="oldest">Earliest edits</option><option value="title">Title A–Z</option>
          </select>
          <div className="ct-view-switch" role="group" aria-label="Article view">
            <button type="button" aria-pressed={view === "grid"} onClick={() => changeView("grid")}><LayoutGrid size={15} /> Grid</button>
            <button type="button" aria-pressed={view === "list"} onClick={() => changeView("list")}><List size={16} /> List</button>
          </div>
        </div> : null}
        {matches.length ? <ul className={`ct-index-items ct-index-${view}`}>
          {matches.map((article) => <li key={article.id}><ArticleEntry article={article} view={view} from={route}
            onDelete={() => void deleteArticle(article)} onExport={() => setExporting(article)} /></li>)}
        </ul> : <p className="ct-quiet ct-collection-empty" role="status">{count ? "No articles match these filters." : "No articles yet."}</p>}
      </section>
      {volumes.length ? <section className="ct-collection-volumes" aria-labelledby="ct-volumes">
        <h2 id="ct-volumes">Volumes</h2>
        <ul>{volumes.map((volume) => <li key={volume.id}>
          <button type="button" onClick={() => catalogue.navigate({ view: "volume", id: volume.id })}>
            <BookMarked size={17} aria-hidden="true" /><span><strong>{volume.title}</strong>{volume.edition ? <small>{volume.edition}</small> : null}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </li>)}</ul>
      </section> : null}
    </>}
  </div>;
}
