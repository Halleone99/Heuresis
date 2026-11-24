import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  EMPTY_CATALOGUE, normaliseArticle, type CatalogueArticle, type CatalogueSnapshot, type CatalogueSubject, type CatalogueVolume,
} from "../../lib/catalogue/model";
import * as store from "../../lib/catalogue/store";
import { subscribeReplayedRows } from "../../lib/offlineFetch";
import { useWorkspace } from "../workspace/WorkspaceContext";

export type CatalogueShelfRoute = { view: "library" } | { view: "independent" }
  | { view: "collection"; id: string } | { view: "volume"; id: string };
type ReaderRoute = { view: "read"; id: string; from?: CatalogueShelfRoute };
export type CatalogueRoute = CatalogueShelfRoute | ReaderRoute
  | { view: "design"; id: string; from?: ReaderRoute | CatalogueShelfRoute };

export function catalogueShelf(route: CatalogueRoute): CatalogueShelfRoute {
  if (route.view === "read" || route.view === "design") return route.from ? catalogueShelf(route.from) : { view: "library" };
  return route;
}

type CatalogueValue = {
  userId: string;
  loading: boolean;
  error: string;
  schema: store.CatalogueSchema | null;
  snapshot: CatalogueSnapshot;
  deleted: CatalogueArticle[];
  reload: (silent?: boolean) => Promise<void>;
  route: CatalogueRoute;
  navigate: (route: CatalogueRoute, options?: { replace?: boolean }) => void;
  returnTo: (route: CatalogueRoute) => void;
  subjectById: Map<string, CatalogueSubject>;
  volumeById: Map<string, CatalogueVolume>;
  articleById: Map<string, CatalogueArticle>;
  addSubject: (name: string, details?: store.SubjectDetails) => Promise<CatalogueSubject>;
  changeSubject: (subject: CatalogueSubject, patch: store.SubjectInput) => Promise<void>;
  removeSubject: (id: string) => Promise<void>;
  addVolume: (input: store.VolumeInput) => Promise<CatalogueVolume>;
  changeVolume: (volume: CatalogueVolume, patch: Partial<store.VolumeInput>) => Promise<CatalogueVolume>;
  removeVolume: (id: string) => Promise<void>;
  addArticle: (article: CatalogueArticle) => Promise<CatalogueArticle>;
  /** The designer saved a new revision. */
  articleSaved: (article: CatalogueArticle) => void;
  patchArticle: (article: CatalogueArticle, patch: store.ArticlePatch) => Promise<CatalogueArticle>;
  removeArticle: (article: CatalogueArticle) => Promise<void>;
  restoreArticle: (article: CatalogueArticle) => Promise<void>;
  purgeArticle: (article: CatalogueArticle) => Promise<void>;
  /** Kicker shown on an article's pages: its volume or subject. */
  labelFor: (article: CatalogueArticle) => { kicker: string; runningTitle: string };
};

const CatalogueContext = createContext<CatalogueValue | null>(null);
export function useCatalogue() {
  const value = useContext(CatalogueContext);
  if (!value) throw new Error("useCatalogue must be used inside CatalogueProvider");
  return value;
}

const routeKey = (userId: string) => `heuresis.catalogue.route.v1:${userId}`;
type HistoryEntry = { userId: string; route: CatalogueRoute; previous?: CatalogueRoute };
function historyEntry(userId: string) {
  const entry = window.history.state?.heuresisCatalogue as HistoryEntry | undefined;
  return entry?.userId === userId ? entry : undefined;
}
function readRoute(userId: string): CatalogueRoute {
  const entry = historyEntry(userId);
  if (entry) return entry.route;
  try {
    const raw = sessionStorage.getItem(routeKey(userId));
    const parsed = raw ? JSON.parse(raw) as CatalogueRoute & { subjectId?: string } : null;
    if (parsed?.view === "library" && parsed.subjectId) return { view: "collection", id: parsed.subjectId };
    if (parsed && ["library", "collection", "independent", "volume", "read", "design"].includes(parsed.view)) return parsed;
  } catch { /* convenience only */ }
  return { view: "library" };
}

export function CatalogueProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const workspace = useWorkspace();
  const [snapshot, setSnapshot] = useState<CatalogueSnapshot>(EMPTY_CATALOGUE);
  const [deleted, setDeleted] = useState<CatalogueArticle[]>([]);
  const [schema, setSchema] = useState<store.CatalogueSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<CatalogueRoute>(() => readRoute(userId));
  const loaded = useRef(false);

  const showRoute = useCallback((next: CatalogueRoute, scrollToTop: boolean) => {
    setRoute(next);
    try { sessionStorage.setItem(routeKey(userId), JSON.stringify(next)); } catch { /* optional */ }
    if (scrollToTop && next.view !== "read" && next.view !== "design") window.scrollTo(0, 0);
  }, [userId]);

  const navigate = useCallback((next: CatalogueRoute, options?: { replace?: boolean }) => {
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    const entry = historyEntry(userId);
    const state = { ...window.history.state, heuresisCatalogue: {
      userId, route: next, previous: options?.replace ? entry?.previous : route,
    } };
    if (options?.replace) window.history.replaceState(state, "");
    else {
      if (!entry) window.history.replaceState({ ...window.history.state, heuresisCatalogue: { userId, route } }, "");
      window.history.pushState(state, "");
    }
    showRoute(next, true);
  }, [route, showRoute, userId]);

  const returnTo = useCallback((next: CatalogueRoute) => {
    const previous = historyEntry(userId)?.previous;
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) window.history.back();
    else navigate(next, { replace: true });
  }, [navigate, userId]);

  useEffect(() => {
    const onPop = () => {
      const entry = historyEntry(userId);
      if (!entry) return;
      // Commit a focused designer field before its editor is unmounted.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      showRoute(entry.route, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [showRoute, userId]);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await store.loadCatalogue(userId);
      setSchema(result.schema);
      setSnapshot(result.snapshot);
      setDeleted(result.deleted);
      setError("");
      loaded.current = true;
    } catch (cause) {
      if (!silent || !loaded.current) setError(store.catalogueError(cause));
    } finally { if (!silent) setLoading(false); }
  }, [userId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onOnline = () => { void reload(true); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [reload]);
  // An article saved offline and replayed later: take the server's revision.
  useEffect(() => subscribeReplayedRows(({ table, row }) => {
    if (table !== "catalogue_articles") return;
    const article = normaliseArticle(row);
    setSnapshot((current) => ({ ...current, articles: current.articles.map((item) => item.id === article.id ? article : item) }));
  }), []);

  const subjectById = useMemo(() => new Map(snapshot.subjects.map((row) => [row.id, row])), [snapshot.subjects]);
  const volumeById = useMemo(() => new Map(snapshot.volumes.map((row) => [row.id, row])), [snapshot.volumes]);
  const articleById = useMemo(() => new Map(snapshot.articles.map((row) => [row.id, row])), [snapshot.articles]);

  const replace = useCallback((article: CatalogueArticle) => setSnapshot((current) => ({
    ...current,
    articles: current.articles.some((item) => item.id === article.id)
      ? current.articles.map((item) => item.id === article.id ? article : item) : [...current.articles, article],
  })), []);

  const value = useMemo<CatalogueValue>(() => ({
    userId, loading, error, schema, snapshot, deleted, reload, route, navigate, returnTo, subjectById, volumeById, articleById,
    async addSubject(name, details) {
      const sortOrder = snapshot.subjects.reduce((next, subject) => Math.max(next, subject.sort_order + 1), 0);
      const created = await store.createSubject(userId, name, sortOrder, details);
      setSnapshot((current) => ({ ...current, subjects: [...current.subjects, created] }));
      return created;
    },
    async changeSubject(subject, patch) {
      const updated = await store.updateSubject(subject, patch);
      setSnapshot((current) => ({ ...current, subjects: current.subjects.map((row) => row.id === subject.id ? updated : row) }));
    },
    async removeSubject(id) {
      await store.deleteSubject(userId, id);
      setSnapshot((current) => ({
        subjects: current.subjects.filter((row) => row.id !== id),
        volumes: current.volumes.map((row) => row.subject_id === id ? { ...row, subject_id: null } : row),
        articles: current.articles.map((row) => row.subject_id === id ? { ...row, subject_id: null } : row),
      }));
      setDeleted((current) => current.map((row) => row.subject_id === id ? { ...row, subject_id: null } : row));
    },
    async addVolume(input) {
      const order = snapshot.volumes.filter((row) => row.subject_id === input.subject_id).length;
      const created = await store.createVolume(userId, input, order);
      setSnapshot((current) => ({ ...current, volumes: [...current.volumes, created] }));
      return created;
    },
    async changeVolume(volume, patch) {
      const updated = await store.updateVolume(userId, volume, patch);
      setSnapshot((current) => ({ ...current, volumes: current.volumes.map((row) => row.id === volume.id ? updated : row) }));
      return updated;
    },
    async removeVolume(id) {
      await store.deleteVolume(userId, id);
      setSnapshot((current) => ({
        ...current,
        volumes: current.volumes.filter((row) => row.id !== id),
        articles: current.articles.map((row) => row.volume_id === id ? { ...row, volume_id: null } : row),
      }));
      setDeleted((current) => current.map((row) => row.volume_id === id ? { ...row, volume_id: null } : row));
    },
    async addArticle(article) {
      const created = await store.createArticle(article);
      replace(created);
      return created;
    },
    articleSaved: replace,
    async patchArticle(article, patch) {
      const latest = articleById.get(article.id) ?? article;
      const updated = await store.updateArticle(latest, patch);
      replace(updated);
      return updated;
    },
    async removeArticle(article) {
      await store.deleteArticle(article);
      setSnapshot((current) => ({ ...current, articles: current.articles.filter((row) => row.id !== article.id) }));
      setDeleted((current) => [article, ...current.filter((row) => row.id !== article.id)]);
      workspace.toast(`“${article.title || "Untitled article"}” moved to deleted articles.`, {
        action: { label: "Undo", run: () => {
          void store.restoreArticle(article).then(() => {
            setDeleted((current) => current.filter((row) => row.id !== article.id));
            replace(article);
          }).catch((cause) => workspace.toast(store.catalogueError(cause), { tone: "error" }));
        } },
      });
    },
    async restoreArticle(article) {
      await store.restoreArticle(article);
      setDeleted((current) => current.filter((row) => row.id !== article.id));
      replace(article);
    },
    async purgeArticle(article) {
      await store.purgeArticle(article);
      setDeleted((current) => current.filter((row) => row.id !== article.id));
    },
    labelFor(article) {
      const volume = article.volume_id ? volumeById.get(article.volume_id) : undefined;
      const subject = article.subject_id ? subjectById.get(article.subject_id) : undefined;
      const kicker = volume ? [subject?.name, volume.edition || volume.title].filter(Boolean).join(" · ") : subject?.name ?? "";
      return { kicker, runningTitle: volume?.title ?? article.title };
    },
  }), [articleById, deleted, error, loading, navigate, reload, replace, returnTo, route, schema, snapshot, subjectById, userId, volumeById, workspace]);

  return <CatalogueContext.Provider value={value}>{children}</CatalogueContext.Provider>;
}
