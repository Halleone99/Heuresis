import { useMemo, useState } from "react";
import { BookMarked, FilePlus2, FolderPlus, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import {
  articleExcerpt, articleText, articleTitle, normaliseSearch, sortArticles,
  type CatalogueArticle, type CatalogueSubject, type CatalogueVolume,
} from "../../lib/catalogue/model";
import { catalogueError } from "../../lib/catalogue/store";
import { useConfirm } from "../workspace/ui";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ImageFrame } from "./ArticlePage";
import { useCatalogue } from "./CatalogueData";
import { CreateArticleDialog } from "./CreateArticleDialog";
import { Dialog, Field, Menu, PageThumb, Segmented, formatDate } from "./parts";
import { VolumeDialog } from "./VolumeView";

type StatusFilter = "all" | "published" | "draft";

export function ArticleCard({ article, onOpen, compact = false }: { article: CatalogueArticle; onOpen: () => void; compact?: boolean }) {
  const catalogue = useCatalogue();
  const labels = catalogue.labelFor(article);
  const subject = article.subject_id ? catalogue.subjectById.get(article.subject_id) : null;
  const volume = article.volume_id ? catalogue.volumeById.get(article.volume_id) : null;
  const cover = article.cover ?? null;
  const width = compact ? 150 : 196;
  return <article className={`ct-card ${article.status === "draft" ? "is-draft" : ""}`}>
    <button type="button" className="ct-card-open" onClick={onOpen} aria-label={`${article.status === "draft" ? "Edit draft" : "Read"} ${articleTitle(article)}`}>
      <span className="ct-card-cover" style={{ width: "100%", maxWidth: width }}>
        {cover ? <span className="ct-card-image"><ImageFrame image={cover} aspect={1 / 1.414} /></span>
          : <PageThumb article={article} page={article.pages[0]} pageIndex={0} width={width} kicker={labels.kicker} runningTitle={labels.runningTitle} />}
      </span>
      <span className="ct-card-text">
        <span className="ct-card-kicker">{[subject?.name, volume ? volume.edition || volume.title : null].filter(Boolean).join(" · ") || "Unfiled"}</span>
        <strong>{articleTitle(article)}</strong>
        {!compact && (article.subtitle || articleExcerpt(article, 110)) ? <span className="ct-card-excerpt">{article.subtitle || articleExcerpt(article, 110)}</span> : null}
        <span className="ct-card-meta">{article.status === "draft" ? <em>Draft</em> : null}{formatDate(article.status === "published" ? article.published_at ?? article.updated_at : article.updated_at)}</span>
      </span>
    </button>
  </article>;
}

export function VolumeCard({ volume, onOpen }: { volume: CatalogueVolume; onOpen: () => void }) {
  const catalogue = useCatalogue();
  const subject = volume.subject_id ? catalogue.subjectById.get(volume.subject_id) : null;
  return <article className="ct-card ct-volume-card">
    <button type="button" className="ct-card-open" onClick={onOpen} aria-label={`Open volume ${volume.title}`}>
      <span className="ct-volume-cover">
        {volume.cover ? <span className="ct-volume-image"><ImageFrame image={volume.cover} aspect={196 / 277} /></span> : null}
        <span className="ct-volume-plate">
          <small>{subject?.name ?? "Volume"}</small>
          <strong>{volume.title}</strong>
          {volume.edition ? <em>{volume.edition}</em> : null}
        </span>
      </span>
      <span className="ct-card-text">
        <span className="ct-card-kicker">{volume.edition || "Volume"}</span>
        <strong>{volume.title}</strong>
        {volume.subtitle ? <span className="ct-card-excerpt">{volume.subtitle}</span> : null}
        <span className="ct-card-meta">{volume.edition_date ? formatDate(volume.edition_date) : null}</span>
      </span>
    </button>
  </article>;
}

function SubjectDialog({ subject, onClose }: { subject: CatalogueSubject | null; onClose: () => void }) {
  const catalogue = useCatalogue();
  const [name, setName] = useState(subject?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (subject) await catalogue.renameSubject(subject.id, name);
      else await catalogue.addSubject(name);
      onClose();
    } catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(false); }
  }
  return <Dialog title={subject ? "Rename subject" : "New subject"} onClose={onClose}
    actions={<><button type="button" className="ws-button" onClick={onClose}>Cancel</button>
      <button type="button" className="ws-button is-primary" disabled={!name.trim() || busy} onClick={() => void save()}>{subject ? "Rename" : "Create subject"}</button></>}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Field label="Name"><input autoFocus maxLength={120} value={name} placeholder="History, Philosophy, Science…" onChange={(event) => setName(event.target.value)} /></Field>
      {error ? <p className="ct-error" role="alert">{error}</p> : null}
    </form>
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

export function CatalogueLibrary() {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const { snapshot } = catalogue;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>(() => catalogue.route.view === "library" && catalogue.route.subjectId ? catalogue.route.subjectId : "all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [subjectDialog, setSubjectDialog] = useState<{ subject: CatalogueSubject | null } | null>(null);
  const [volumeDialog, setVolumeDialog] = useState<{ volume: CatalogueVolume | null; subjectId: string | null } | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [confirmElement, confirm] = useConfirm();

  const articles = useMemo(() => sortArticles(snapshot.articles), [snapshot.articles]);
  const subjects = snapshot.subjects;
  const empty = !snapshot.articles.length && !snapshot.volumes.length && !snapshot.subjects.length;
  const search = normaliseSearch(query);
  const filtering = Boolean(search) || subjectFilter !== "all" || status !== "all";

  const open = (article: CatalogueArticle) => catalogue.navigate(article.status === "published"
    ? { view: "read", id: article.id, from: { view: "library" } } : { view: "design", id: article.id, from: { view: "library" } });

  const matches = useMemo(() => articles.filter((article) => {
    if (status !== "all" && article.status !== status) return false;
    if (subjectFilter === "none" && article.subject_id) return false;
    if (subjectFilter !== "all" && subjectFilter !== "none" && article.subject_id !== subjectFilter) return false;
    if (!search) return true;
    const volume = article.volume_id ? catalogue.volumeById.get(article.volume_id) : null;
    const subject = article.subject_id ? catalogue.subjectById.get(article.subject_id) : null;
    return normaliseSearch([articleText(article), volume?.title, subject?.name].filter(Boolean).join(" ")).includes(search);
  }), [articles, catalogue.subjectById, catalogue.volumeById, search, status, subjectFilter]);
  const matchingVolumes = useMemo(() => snapshot.volumes.filter((volume) => {
    if (status === "draft") return false;
    if (subjectFilter === "none" && volume.subject_id) return false;
    if (subjectFilter !== "all" && subjectFilter !== "none" && volume.subject_id !== subjectFilter) return false;
    return !search || normaliseSearch(`${volume.title} ${volume.subtitle} ${volume.edition}`).includes(search);
  }), [search, snapshot.volumes, status, subjectFilter]);

  async function deleteSubject(subject: CatalogueSubject) {
    const ok = await confirm({ title: `Delete the subject “${subject.name}”?`, confirmLabel: "Delete subject", danger: true,
      body: "Its volumes and articles are kept; they will simply have no subject. Nothing in the Notebook is affected." });
    if (!ok) return;
    try { await catalogue.removeSubject(subject.id); workspace.toast("Subject deleted. Its articles are kept."); }
    catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
  }

  const moreMenu = <Menu label="More Catalogue actions" items={[
    { label: "New subject", icon: <FolderPlus size={14} />, run: () => setSubjectDialog({ subject: null }) },
    { label: "New volume", icon: <BookMarked size={14} />, run: () => setVolumeDialog({ volume: null, subjectId: subjectFilter !== "all" && subjectFilter !== "none" ? subjectFilter : null }) },
    "divider",
    { label: `Deleted articles${catalogue.deleted.length ? ` (${catalogue.deleted.length})` : ""}`, icon: <Trash2 size={14} />, run: () => setDeletedOpen(true) },
  ]} />;

  const dialogs = <>
    {confirmElement}
    {creating ? <CreateArticleDialog onClose={() => setCreating(false)} defaultSubjectId={subjectFilter !== "all" && subjectFilter !== "none" ? subjectFilter : null} /> : null}
    {subjectDialog ? <SubjectDialog subject={subjectDialog.subject} onClose={() => setSubjectDialog(null)} /> : null}
    {volumeDialog ? <VolumeDialog volume={volumeDialog.volume} subjectId={volumeDialog.subjectId} onClose={() => setVolumeDialog(null)}
      onSaved={(volume, created) => { if (created) catalogue.navigate({ view: "volume", id: volume.id }); }} /> : null}
    {deletedOpen ? <DeletedDialog onClose={() => setDeletedOpen(false)} /> : null}
  </>;

  if (empty) return <div className="ct-library is-empty">
    {dialogs}
    <div className="ct-empty">
      <h1>Catalogue</h1>
      <p><em>Your collection of articles, essays and illustrated works.</em></p>
      <button type="button" className="ct-create is-large" onClick={() => setCreating(true)}><FilePlus2 size={17} strokeWidth={1.6} /> Create Article</button>
      {catalogue.deleted.length ? <button type="button" className="ct-link" onClick={() => setDeletedOpen(true)}>Deleted articles ({catalogue.deleted.length})</button> : null}
    </div>
  </div>;

  const drafts = articles.filter((article) => article.status === "draft");
  const shelf = (subjectId: string | null) => ({
    volumes: snapshot.volumes.filter((volume) => volume.subject_id === subjectId).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
    loose: articles.filter((article) => article.status === "published" && article.subject_id === subjectId && !article.volume_id),
  });
  const unfiled = shelf(null);

  return <div className="ct-library">
    {dialogs}
    <header className="ct-masthead">
      <div>
        <h1>Catalogue</h1>
        <p><em>Your collection of articles, essays and illustrated works.</em></p>
      </div>
      <div className="ct-masthead-actions">
        <button type="button" className="ct-create" onClick={() => setCreating(true)}><Plus size={15} /> Create Article</button>
        {moreMenu}
      </div>
    </header>

    <div className="ct-toolbar" role="search">
      <label className="ct-search"><Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and text" aria-label="Search the Catalogue" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button> : null}
      </label>
      <select aria-label="Subject" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}>
        <option value="all">All subjects</option>
        {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        <option value="none">Unfiled</option>
      </select>
      <Segmented label="Status" value={status} onChange={setStatus} options={[
        { value: "all", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Drafts" },
      ]} />
    </div>

    {filtering ? <section className="ct-shelf">
      {matchingVolumes.length ? <div className="ct-grid">{matchingVolumes.map((volume) => <VolumeCard key={volume.id} volume={volume} onOpen={() => catalogue.navigate({ view: "volume", id: volume.id })} />)}</div> : null}
      {matches.length ? <div className="ct-grid">{matches.map((article) => <ArticleCard key={article.id} article={article} onOpen={() => open(article)} />)}</div>
        : !matchingVolumes.length ? <p className="ct-quiet">Nothing matches. Try another word or filter.</p> : null}
    </section> : <>
      {drafts.length ? <section className="ct-shelf" aria-labelledby="ct-drafts">
        <div className="ct-shelf-head"><h2 id="ct-drafts">Drafts</h2><span>Not yet published</span></div>
        <div className="ct-grid is-compact">{drafts.map((article) => <ArticleCard key={article.id} article={article} compact onOpen={() => open(article)} />)}</div>
      </section> : null}
      {subjects.map((subject) => {
        const { volumes, loose } = shelf(subject.id);
        return <section className="ct-shelf" key={subject.id} aria-label={subject.name}>
          <div className="ct-shelf-head">
            <h2>{subject.name}</h2>
            <Menu label={`Actions for ${subject.name}`} items={[
              { label: "New volume in this subject", icon: <BookMarked size={14} />, run: () => setVolumeDialog({ volume: null, subjectId: subject.id }) },
              { label: "Rename", icon: <Pencil size={14} />, run: () => setSubjectDialog({ subject }) },
              { label: "Delete subject", icon: <Trash2 size={14} />, danger: true, run: () => void deleteSubject(subject) },
            ]} />
          </div>
          {volumes.length || loose.length ? <div className="ct-grid">
            {volumes.map((volume) => <VolumeCard key={volume.id} volume={volume} onOpen={() => catalogue.navigate({ view: "volume", id: volume.id })} />)}
            {loose.map((article) => <ArticleCard key={article.id} article={article} onOpen={() => open(article)} />)}
          </div> : <p className="ct-quiet">No published articles yet.</p>}
        </section>;
      })}
      {unfiled.volumes.length || unfiled.loose.length ? <section className="ct-shelf" aria-label="Unfiled">
        <div className="ct-shelf-head"><h2>{subjects.length ? "Unfiled" : "Articles"}</h2></div>
        <div className="ct-grid">
          {unfiled.volumes.map((volume) => <VolumeCard key={volume.id} volume={volume} onOpen={() => catalogue.navigate({ view: "volume", id: volume.id })} />)}
          {unfiled.loose.map((article) => <ArticleCard key={article.id} article={article} onOpen={() => open(article)} />)}
        </div>
      </section> : null}
    </>}
  </div>;
}
