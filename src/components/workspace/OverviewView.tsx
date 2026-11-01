import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, FileText, Layers3, Newspaper } from "lucide-react";
import { loadStudyActivity, loadStudyInventory, weekStart, type StudyActivity, type StudyInventoryCard } from "../../lib/activity";
import type { PackWithType } from "../../lib/heuresis";
import { bookReadingDays, useReadingLibrary } from "../../lib/readingBridge";
import { supabase } from "../../lib/supabase";
import { useWorkspace } from "./WorkspaceContext";
import "./overview-heatmap.css";

type Props = {
  packs: PackWithType[];
  studyLoading: boolean;
  studyError: string;
  onOpenStudy: () => void;
};
type ActivityKind = "flashcards" | "notes" | "reading" | "articles";
type ArticleSummary = {
  id: string; status: string; created_at: string; updated_at: string; published_at: string | null;
};
type RecentEntry = { label: string; day: string | null; unavailable?: boolean };
const DAY_MS = 86400000;
const ACTIVITY_OPTIONS: Array<{ value: ActivityKind; label: string; unit: string }> = [
  { value: "flashcards", label: "Flashcards", unit: "cards reviewed" },
  { value: "notes", label: "Notes", unit: "notes created or last updated" },
  { value: "reading", label: "Reading", unit: "minutes logged" },
  { value: "articles", label: "Articles", unit: "articles created, last edited or published" },
];

function dayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function dateDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dayKey(date) : null;
}
function addDay(map: Map<string, number>, key: string | null, amount = 1) {
  if (key) map.set(key, (map.get(key) ?? 0) + amount);
}
function latestDay(map: Map<string, number>): string | null {
  const days = [...map.keys()].sort();
  return days.length ? days[days.length - 1] : null;
}
function when(day: string | null, today: string): string {
  if (!day) return "";
  if (day === today) return "Today";
  const now = new Date(today + "T12:00:00");
  now.setDate(now.getDate() - 1);
  if (day === dayKey(now)) return "Yesterday";
  return new Date(day + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function level(count: number): string {
  return count === 0 ? "0" : count === 1 ? "1" : count <= 3 ? "2" : count <= 7 ? "3" : "4";
}
const number = (value: number | null) => value === null ? "—" : value.toLocaleString("en-GB");
const added = (value: number | null) => value === null ? "—" : "+" + number(value);

export function OverviewView({ packs, studyLoading, studyError, onOpenStudy }: Props) {
  const workspace = useWorkspace();
  const { userId } = workspace;
  const reading = useReadingLibrary(userId);
  const [kind, setKind] = useState<ActivityKind>("flashcards");
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(true);
  const [inventory, setInventory] = useState<StudyInventoryCard[] | null>(null);
  const [inventoryError, setInventoryError] = useState("");
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [articleError, setArticleError] = useState("");
  const [articleLoading, setArticleLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setActivityLoading(true);
    setActivityError("");
    setActivity(null);
    void loadStudyActivity(userId, 190, 0)
      .then((data) => { if (active) setActivity(data); })
      .catch((error) => { if (active) setActivityError(error instanceof Error ? error.message : "Review history unavailable."); })
      .finally(() => { if (active) setActivityLoading(false); });
    return () => { active = false; };
  }, [userId, retry]);

  useEffect(() => {
    let active = true;
    setInventory(null);
    setInventoryError("");
    if (studyLoading || studyError) {
      setInventoryLoading(studyLoading);
      return () => { active = false; };
    }
    setInventoryLoading(true);
    void loadStudyInventory(packs.map((pack) => pack.id))
      .then((rows) => { if (active) setInventory(rows); })
      .catch((error) => { if (active) setInventoryError(error instanceof Error ? error.message : "Card inventory unavailable."); })
      .finally(() => { if (active) setInventoryLoading(false); });
    return () => { active = false; };
  }, [packs, studyLoading, studyError, retry]);

  // Catalogue articles are independent of the Notebook. Fetch only metadata:
  // full article pages and images would be unnecessarily expensive for Overview.
  useEffect(() => {
    let active = true;
    setArticleLoading(true);
    setArticleError("");
    setArticles(null);
    void (async () => {
      if (!supabase) throw new Error("The Catalogue database is not configured.");
      const rows: ArticleSummary[] = [];
      for (let page = 0; page < 20; page++) {
        const { data, error } = await supabase.from("catalogue_articles")
          .select("id,status,created_at,updated_at,published_at")
          .eq("user_id", userId).is("deleted_at", null)
          .order("created_at", { ascending: false })
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        const batch = (data ?? []) as ArticleSummary[];
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
      if (active) setArticles(rows);
    })().catch((error) => {
      if (active) setArticleError(error instanceof Error ? error.message : "Article statistics unavailable.");
    }).finally(() => { if (active) setArticleLoading(false); });
    return () => { active = false; };
  }, [userId, retry]);

  const calendar = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() - 25 * 7);
    const today = dayKey(new Date());
    const days = Array.from({ length: 26 * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const key = dayKey(date);
      return { key, label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), future: key > today };
    });
    const weeks = Array.from({ length: 26 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index * 7);
      const previous = new Date(date);
      previous.setDate(previous.getDate() - 7);
      return { key: dayKey(date), label: index === 0 || date.getMonth() !== previous.getMonth()
        ? date.toLocaleDateString("en-GB", { month: "short" }) : "" };
    });
    return { days, weeks, first: days[0].key, today };
  }, []);
  const last30 = useMemo(() => Date.now() - 30 * DAY_MS, []);
  const inPeriod = (day: string | null) => day !== null && day >= calendar.first && day <= calendar.today;
  const inLast30 = (date: string | null | undefined) => Boolean(date && new Date(date).getTime() >= last30);

  const currentCardIds = useMemo(() => inventory
    ? new Set(inventory.filter((card) => card.retention === "learning").map((card) => card.id))
    : null, [inventory]);
  const reviews = useMemo(() => {
    const packIds = new Set(packs.map((pack) => pack.id));
    return (activity?.reviews ?? []).filter((review) =>
      Boolean(review.card_id && packIds.has(review.pack_id) &&
        (!currentCardIds || currentCardIds.has(review.card_id)) && inPeriod(dateDay(review.created_at))));
  // Calendar dates are stable for the lifetime of this page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, packs, currentCardIds, calendar.first, calendar.today]);
  const reviewMonth = useMemo(() => new Set(reviews.filter((review) => inLast30(review.created_at)).map((review) => review.card_id)).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviews, last30]);
  const flashDays = useMemo(() => {
    const dayCards = new Map<string, Set<string>>();
    for (const review of reviews) {
      const day = dateDay(review.created_at);
      if (!day) continue;
      if (!dayCards.has(day)) dayCards.set(day, new Set());
      dayCards.get(day)!.add(review.card_id);
    }
    return new Map([...dayCards].map(([day, ids]) => [day, ids.size]));
  }, [reviews]);

  const documents = useMemo(() => workspace.snapshot.entries.filter((entry) => entry.kind === "note"), [workspace.snapshot.entries]);
  const noteDays = useMemo(() => {
    const days = new Map<string, number>();
    for (const note of documents) {
      const created = dateDay(note.created_at);
      const updated = dateDay(note.updated_at);
      if (inPeriod(created)) addDay(days, created);
      if (updated !== created && inPeriod(updated)) addDay(days, updated);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, calendar.first, calendar.today]);

  const readingDays = useMemo(() => {
    const days = new Map<string, number>();
    for (const book of reading.books) {
      for (const log of bookReadingDays(book)) if (inPeriod(log.date)) addDay(days, log.date, log.minutes);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading.books, calendar.first, calendar.today]);

  const articleDays = useMemo(() => {
    const perDay = new Map<string, Set<string>>();
    for (const article of articles ?? []) {
      for (const day of new Set([dateDay(article.created_at), dateDay(article.updated_at), dateDay(article.published_at)])) {
        if (!inPeriod(day)) continue;
        if (!perDay.has(day!)) perDay.set(day!, new Set());
        perDay.get(day!)!.add(article.id);
      }
    }
    return new Map([...perDay].map(([day, ids]) => [day, ids.size]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles, calendar.first, calendar.today]);

  const cardTotal = studyLoading || studyError ? null : inventory ? inventory.length : packs.reduce((sum, pack) => sum + pack.card_count, 0);
  const cardAdded = inventoryLoading || inventoryError || !inventory ? null : inventory.filter((card) => inLast30(card.created_at)).length;
  const cardReviewed = activityLoading || activityError || !activity || inventoryLoading || inventoryError ? null : reviewMonth;
  const learningTotal = inventoryLoading || inventoryError || !inventory ? null : inventory.filter((card) => card.retention === "learning").length;
  const noteTotal = workspace.loading || workspace.error ? null : documents.length;
  const noteAdded = noteTotal === null ? null : documents.filter((note) => inLast30(note.created_at)).length;
  const noteUpdated = noteTotal === null ? null : documents.filter((note) => inLast30(note.updated_at) && !inLast30(note.created_at)).length;
  const bookTotal = reading.loading || reading.error ? null : reading.books.length;
  const articleTotal = articleLoading || articleError || !articles ? null : articles.length;
  const articleAdded = articleTotal === null ? null : articles!.filter((row) => inLast30(row.created_at)).length;
  const articlePublished = articleTotal === null ? null : articles!.filter((row) => row.status === "published" && inLast30(row.published_at)).length;

  const activityMap = { flashcards: flashDays, notes: noteDays, reading: readingDays, articles: articleDays }[kind];
  const activeOption = ACTIVITY_OPTIONS.find((option) => option.value === kind)!;
  const selectedLoading = { flashcards: activityLoading || inventoryLoading || studyLoading, notes: workspace.loading,
    reading: reading.loading, articles: articleLoading }[kind];
  const selectedError = { flashcards: activityError || inventoryError || studyError, notes: workspace.error,
    reading: reading.error, articles: articleError }[kind];

  const newestNote = [...documents].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const newestArticle = [...(articles ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const lastFlash = latestDay(flashDays);
  const lastRead = latestDay(readingDays);
  const recentItems: Array<{ kind: ActivityKind; item: RecentEntry }> = [
    { kind: "flashcards", item: cardReviewed === null ? { label: "Unavailable", day: null, unavailable: true }
      : { label: lastFlash ? number(flashDays.get(lastFlash) ?? 0) + " cards reviewed" : "No reviews yet", day: lastFlash } },
    { kind: "notes", item: noteTotal === null ? { label: "Unavailable", day: null, unavailable: true }
      : { label: newestNote ? (newestNote.updated_at === newestNote.created_at ? "Note added" : "Note updated") : "No notes yet",
        day: newestNote ? dateDay(newestNote.updated_at) : null } },
    { kind: "reading", item: bookTotal === null ? { label: "Unavailable", day: null, unavailable: true }
      : { label: lastRead ? number(readingDays.get(lastRead) ?? 0) + " min logged" : "No reading logged", day: lastRead } },
    { kind: "articles", item: articleTotal === null ? { label: "Unavailable", day: null, unavailable: true }
      : { label: newestArticle ? (newestArticle.created_at === newestArticle.updated_at ? "Article added" : "Article updated") : "No articles yet",
        day: newestArticle ? dateDay(newestArticle.updated_at) : null } },
  ];
  const icons = { flashcards: Layers3, notes: FileText, reading: BookOpen, articles: Newspaper };
  const navigation = { flashcards: onOpenStudy, notes: () => workspace.goTo("notebook"),
    reading: () => workspace.goTo("reading"), articles: () => workspace.goTo("reference") };

  return <div className="ov-page oh-overview">
    <header className="oh-page-header">
      <div><h1>Library</h1><p>Overview of your flashcards, notes, reading and articles.</p></div>
      <span className="oh-date">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
    </header>

    <div className="oh-dashboard-cards">
      <button type="button" className="oh-summary-card" onClick={navigation.flashcards} aria-label="Open Flashcards">
        <span className="oh-card-title"><span className="oh-card-icon"><Layers3 size={20}/></span><strong>Flashcards</strong><ChevronRight size={18}/></span>
        <span className="oh-card-metrics"><span className="oh-card-total"><b>{number(cardTotal)}</b><small>Cards</small></span>
          <span className="oh-card-detail"><span><b>{added(cardAdded)}</b><small>Added (30 d)</small></span>
            <span><b>{number(cardReviewed)}</b><small>Reviewed (30 d)</small></span></span></span>
        <span className="oh-card-progress" title="Distinct learning cards reviewed in the last 30 days; not mastery">
          <span className="oh-progress-track"><span style={{ width: cardReviewed !== null && learningTotal ? Math.min(100, cardReviewed / learningTotal * 100) + "%" : "0%" }}/></span>
          <small>{cardReviewed !== null && learningTotal !== null ? number(cardReviewed) + " / " + number(learningTotal) : "—"}</small>
        </span>
      </button>
      <button type="button" className="oh-summary-card" onClick={navigation.notes} aria-label="Open Notes">
        <span className="oh-card-title"><span className="oh-card-icon"><FileText size={20}/></span><strong>Notes</strong><ChevronRight size={18}/></span>
        <span className="oh-card-metrics"><span className="oh-card-total"><b>{number(noteTotal)}</b><small>Notes</small></span>
          <span className="oh-card-detail"><span><b>{added(noteAdded)}</b><small>Added (30 d)</small></span>
            <span><b>{number(noteUpdated)}</b><small>Updated (30 d)</small></span></span></span>
      </button>
      <button type="button" className="oh-summary-card" onClick={navigation.reading} aria-label="Open Reading">
        <span className="oh-card-title"><span className="oh-card-icon"><BookOpen size={20}/></span><strong>Reading</strong><ChevronRight size={18}/></span>
        <span className="oh-card-metrics"><span className="oh-card-total"><b>{number(bookTotal)}</b><small>Books</small></span>
          <span className="oh-card-detail oh-status-detail">
            <span><i/><b>{bookTotal === null ? "—" : reading.books.filter((book) => book.status === "Reading").length}</b><small>Reading</small></span>
            <span><i/><b>{bookTotal === null ? "—" : reading.books.filter((book) => book.status === "To read").length}</b><small>Planned</small></span>
            <span><i/><b>{bookTotal === null ? "—" : reading.books.filter((book) => book.status === "Read").length}</b><small>Finished</small></span>
          </span></span>
      </button>
      <button type="button" className="oh-summary-card" onClick={navigation.articles} aria-label="Open Articles">
        <span className="oh-card-title"><span className="oh-card-icon"><Newspaper size={20}/></span><strong>Articles</strong><ChevronRight size={18}/></span>
        <span className="oh-card-metrics"><span className="oh-card-total"><b>{number(articleTotal)}</b><small>Articles</small></span>
          <span className="oh-card-detail"><span><b>{added(articleAdded)}</b><small>Added (30 d)</small></span>
            <span><b>{number(articlePublished)}</b><small>Published (30 d)</small></span></span></span>
      </button>
    </div>

    <section className="oh-activity-panel" aria-label="Activity heatmap">
      <div className="oh-panel-head">
        <div className="oh-activity-controls">
          <h2>Activity</h2>
          <label className="oh-sr" htmlFor="oh-activity-choice">Activity shown on heatmap</label>
          <select id="oh-activity-choice" className="oh-select" value={kind}
            onChange={(event) => setKind(event.target.value as ActivityKind)}>
            {ACTIVITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <span className="oh-muted">Last 26 weeks</span>
      </div>
      {selectedLoading ? <p className="oh-heat-status" role="status">Loading activity…</p>
        : selectedError ? <p className="oh-heat-status" role="alert">Activity unavailable. <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>
        : <div className="oh-calendar-scroll">
          <div className="oh-calendar-inner">
            <div className="oh-months" aria-hidden="true">{calendar.weeks.map((week) => <span key={week.key}>{week.label}</span>)}</div>
            <div className="oh-calendar-body">
              <div className="oh-weekdays" aria-hidden="true"><span>M</span><span/><span>W</span><span/><span>F</span><span/><span/></div>
              <div className="oh-days" role="img" aria-label={"Daily " + activeOption.unit + " over 26 weeks"}>
                {calendar.days.map((day) => {
                  const count = activityMap.get(day.key) ?? 0;
                  return <span key={day.key} className="oh-cell" data-level={day.future ? "future" : level(count)}
                    title={day.future ? day.label : day.label + " · " + count + " " + activeOption.unit}/>;
                })}
              </div>
            </div>
          </div>
        </div>}
      <div className="oh-calendar-footer"><span>{activeOption.unit}</span>
        <span className="oh-legend">Less {[0, 1, 2, 3, 4].map((n) => <i key={n} className="oh-cell" data-level={String(n)} />)} More</span>
      </div>
    </section>

    <section className="oh-recent-panel" aria-label="Most recent activity">
      <h2>Recent</h2>
      <div className="oh-recent-grid">
        {recentItems.map(({ kind: itemKind, item }) => {
          const Icon = icons[itemKind];
          return <div className="oh-recent-item" key={itemKind}>
            <span className="oh-recent-icon"><Icon size={20}/></span>
            <span><strong>{item.label}</strong><small>{item.unavailable ? "Could not load" : when(item.day, calendar.today)}</small></span>
          </div>;
        })}
      </div>
    </section>
  </div>;
}
