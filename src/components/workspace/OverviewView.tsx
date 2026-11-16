import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, FileText, Layers3, Newspaper, Quote } from "lucide-react";
import { loadStudyActivity, loadStudyInventory, weekStart, type StudyActivity, type StudyInventoryCard } from "../../lib/activity";
import type { PackWithType } from "../../lib/heuresis";
import { useReadingLibrary } from "../../lib/readingBridge";
import { supabase } from "../../lib/supabase";
import { useOverviewStyle } from "../../lib/overviewStyle";
import { useWorkspace } from "./WorkspaceContext";
import "./overview-serif.css";

type Props = {
  packs: PackWithType[];
  studyLoading: boolean;
  studyError: string;
  onOpenStudy: () => void;
};
type ActivityKind = "flashcards" | "notes" | "quotes" | "articles";
type ArticleSummary = {
  id: string; status: string; created_at: string; updated_at: string; published_at: string | null;
};
const DAY_MS = 86400000;
const ACTIVITY_OPTIONS = [
  { value: "flashcards", label: "Flashcards", unit: "cards reviewed", tooltip: "reviews", stat: "Card reviews", icon: Layers3 },
  { value: "notes", label: "Notes", unit: "notes created or updated", tooltip: "updates", stat: "Note updates", icon: FileText },
  { value: "quotes", label: "Quotations", unit: "quotations saved", tooltip: "saved", stat: "Quotations saved", icon: Quote },
  { value: "articles", label: "Articles", unit: "articles created, edited or published", tooltip: "updates", stat: "Article updates", icon: Newspaper },
] as const;

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
// Separate real edits from initial creation; a new note can also be edited within 30 days.
const wasEdited = (entry: { created_at: string; updated_at: string }) =>
  new Date(entry.updated_at).getTime() > new Date(entry.created_at).getTime() + 1000;


export function OverviewView({ packs, studyLoading, studyError, onOpenStudy }: Props) {
  const workspace = useWorkspace();
  const { userId } = workspace;
  const reading = useReadingLibrary(userId);
  const { style: overviewStyle } = useOverviewStyle();
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
    if (weeks[1]?.label || weeks[2]?.label) weeks[0].label = "";
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


  const quotes = reading.quotes;
  const quoteDays = useMemo(() => {
    const days = new Map<string, number>();
    for (const quote of quotes) {
      const date = dateDay(quote.createdAt);
      if (inPeriod(date)) addDay(days, date);
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, calendar.first, calendar.today]);

  const cardTotal = studyLoading || studyError ? null : inventory ? inventory.length : packs.reduce((sum, pack) => sum + pack.card_count, 0);
  const cardAdded = inventoryLoading || inventoryError || !inventory ? null : inventory.filter((card) => inLast30(card.created_at)).length;
  const cardReviewed = activityLoading || activityError || !activity || inventoryLoading || inventoryError ? null : reviewMonth;
  const noteTotal = workspace.loading || workspace.error ? null : documents.length;
  const noteAdded = noteTotal === null ? null : documents.filter((note) => inLast30(note.created_at)).length;
  const noteUpdated = noteTotal === null ? null : documents.filter((note) => inLast30(note.updated_at) && wasEdited(note)).length;
  const quoteTotal = reading.loading || reading.error ? null : quotes.length;
  const quoteSaved30 = quoteTotal === null ? null : quotes.filter((quote) => inLast30(quote.createdAt)).length;
  const quoteAuthors = quoteTotal === null ? null : new Set(quotes.map((quote) => quote.attribution.trim().toLowerCase()).filter(Boolean)).size;
  const articleTotal = articleLoading || articleError || !articles ? null : articles.length;
  const articleAdded = articleTotal === null ? null : articles!.filter((row) => inLast30(row.created_at)).length;
  const articleEdited = articleTotal === null ? null : articles!.filter((row) => inLast30(row.updated_at) && wasEdited(row)).length;

  const activityMap: Record<ActivityKind, Map<string, number>> = {
    flashcards: flashDays, notes: noteDays, quotes: quoteDays, articles: articleDays,
  };
  const selected = activityMap[kind];
  const activeOption = ACTIVITY_OPTIONS.find((option) => option.value === kind)!;
  const selectedLoading = { flashcards: activityLoading || inventoryLoading || studyLoading,
    notes: workspace.loading, quotes: reading.loading, articles: articleLoading }[kind];
  const selectedError = { flashcards: activityError || inventoryError || studyError,
    notes: workspace.error, quotes: reading.error, articles: articleError }[kind];
  const newestNote = [...documents].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const newestQuote = [...quotes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const newestArticle = [...(articles ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const toDate = (day: string | null) => day ? new Date(day + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
  const relative = (day: string | null) => {
    if (!day) return "No activity yet";
    const immediate = when(day, calendar.today);
    if (immediate === "Today" || immediate === "Yesterday") return immediate;
    const days = Math.max(0, Math.round((new Date(calendar.today + "T12:00:00").getTime() - new Date(day + "T12:00:00").getTime()) / DAY_MS));
    if (days < 14) return days + " days ago";
    if (days < 60) return Math.floor(days / 7) + " weeks ago";
    return Math.floor(days / 30) + " months ago";
  };
  const chartDays = (map: Map<string, number>) => Array.from({ length: 30 }, (_, index) => {
    const date = new Date(calendar.today + "T12:00:00");
    date.setDate(date.getDate() - 29 + index);
    const key = dayKey(date);
    return { key, label: date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
      value: map.get(key) ?? 0, isToday: index === 29 };
  });

  const summary = [
    { key: "flashcards", label: "Flashcards", Icon: Layers3, total: cardTotal, unit: "cards",
      a: cardAdded, aLabel: "new", b: cardReviewed, bLabel: "cards reviewed",
      map: flashDays, last: latestDay(flashDays), lastLabel: "Last activity",
      loading: activityLoading || inventoryLoading || studyLoading,
      error: activityError || inventoryError || studyError, open: onOpenStudy },
    { key: "notes", label: "Notes", Icon: FileText, total: noteTotal, unit: "notes",
      a: noteAdded, aLabel: "new", b: noteUpdated, bLabel: "edited",
      map: noteDays, last: newestNote ? dateDay(newestNote.updated_at) : null, lastLabel: "Last activity",
      loading: workspace.loading, error: workspace.error, open: () => workspace.goTo("notebook") },
    { key: "quotes", label: "Quotations", Icon: Quote, total: quoteTotal, unit: "quotations",
      a: quoteSaved30, aLabel: "saved", b: quoteAuthors, bLabel: "authors",
      map: quoteDays, last: newestQuote ? dateDay(newestQuote.createdAt) : null, lastLabel: "Last saved",
      loading: reading.loading, error: reading.error, open: () => workspace.goTo("quotations") },
    { key: "articles", label: "Articles", Icon: Newspaper, total: articleTotal, unit: "articles",
      a: articleAdded, aLabel: "new", b: articleEdited, bLabel: "edited",
      map: articleDays, last: newestArticle ? dateDay(newestArticle.updated_at) : null, lastLabel: "Last activity",
      loading: articleLoading, error: articleError, open: () => workspace.goTo("reference") },
  ];

  const retrySection = (section: ActivityKind) => {
    if (section === "notes") { void workspace.reload().catch(() => undefined); return; }
    if (section === "quotes") { void reading.reload().catch(() => undefined); return; }
    setRetry((value) => value + 1);
  };

  const activeDays = calendar.days.filter((day) => !day.future);
  const totalActivity = activeDays.reduce((sum, day) => sum + (selected.get(day.key) ?? 0), 0);
  const daysWithActivity = activeDays.filter((day) => (selected.get(day.key) ?? 0) > 0).length;
  const displayDate = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(", ", " · ");

  return <div className="ov" data-style={overviewStyle}>
    <header className="ov-head">
      <div className="ov-eyebrow">{displayDate}</div>
      <h1 className="ov-title"><span className="ov-title-main">Heuresis</span>{" "}<span className="ov-title-sub">overview</span></h1>
    </header>
    <div className="ov-cards">
      {summary.map(({ key, label, Icon, total, unit, a, aLabel, b, bLabel, map, last, lastLabel, loading, error, open }) => {
        const bars = chartDays(map);
        const maximum = Math.max(1, ...bars.map((day) => day.value));
        const failed = Boolean(error);
        return <div key={key} className={"ov-card" + (failed ? " is-error" : "")}>
          <button type="button" className="ov-card-link" aria-label={"Open " + label} onClick={open} />
          <div className="ov-card-title">
            <span className="ov-card-icon"><Icon size={17} /></span>
            <span className="ov-card-name">{label}</span>
            {failed ? <span className="ov-badge">Unavailable</span> : <ArrowUpRight size={15} className="ov-card-go" />}
          </div>
          <div className="ov-total"><b>{loading || failed ? "—" : number(total)}</b><small>{unit}</small></div>
          <div className="ov-month">
            <span className="ov-cap">Last 30 days</span>
            <span className="ov-month-row"><b className="is-up">{loading || failed ? "—" : added(a)}</b>{aLabel}</span>
            <span className="ov-month-row"><b>{loading || failed ? "—" : number(b)}</b>{bLabel}</span>
          </div>
          <div className="ov-bars" role="img" aria-label={"Daily " + unit + ", last 30 days"}>
            {bars.map((day) => <i key={day.key}
              className={((!day.value || loading || failed) ? "is-zero " : "") + (day.isToday ? "is-today" : "")}
              style={day.value && !loading && !failed ? { height: (12 + 88 * day.value / maximum) + "%" } : undefined}
              title={(!loading && !failed ? day.value : 0) + " " + unit + " · " + day.label} />)}
          </div>
          <div className="ov-card-foot">
            {failed ? <><span>Could not load</span><button type="button" className="ov-retry" onClick={() => retrySection(key as ActivityKind)}>Retry</button></>
              : loading ? <span>Loading…</span>
              : <><span>{lastLabel}</span><span><b>{toDate(last)}</b> · {relative(last)}</span></>}
          </div>
        </div>;
      })}
    </div>

    <section className="ov-activity" aria-label="Activity">
      <div className="ov-activity-head">
        <h2>Activity <span>Last 26 weeks</span></h2>
        <div className="ov-tabs" role="tablist" aria-label="Activity type">
          {ACTIVITY_OPTIONS.map(({ value, label, icon: Icon }) =>
            <button key={value} type="button" role="tab" className={"ov-tab" + (kind === value ? " is-active" : "")}
              aria-selected={kind === value} onClick={() => setKind(value)}><Icon size={14} />{label}</button>)}
        </div>
      </div>
      <div className="ov-activity-body">
        <div className="ov-heat-wrap">
          {selectedLoading ? <div className="ov-heat-status" role="status">Loading activity…</div>
            : selectedError ? <div className="ov-heat-status" role="alert">Activity unavailable. <button type="button" className="ov-retry" onClick={() => retrySection(kind)}>Retry</button></div>
            : <div className="ov-heat">
              <div className="ov-months" aria-hidden="true">{calendar.weeks.map((week) => <span key={week.key}>{week.label}</span>)}</div>
              <div className="ov-weekdays" aria-hidden="true"><span>Mon</span><span/><span>Wed</span><span/><span>Fri</span><span/><span/></div>
              <div className="ov-days" role="img" aria-label={"Daily " + activeOption.unit + " over 26 weeks"}>
                {calendar.days.map((day) => {
                  const count = selected.get(day.key) ?? 0;
                  return <i key={day.key} className="ov-cell" data-level={day.future ? "future" : level(count)}
                    title={day.future ? day.label : count + " " + activeOption.tooltip + " · " + day.label} />;
                })}
              </div>
            </div>}
          <div className="ov-heat-foot"><span>{activeOption.unit}</span>
            <span className="ov-legend">Less {[0,1,2,3,4].map((value) => <i key={value} className="ov-cell" data-level={String(value)} />)} More</span>
          </div>
        </div>
        <div className="ov-stats">
          <div className="ov-stat"><span>{activeOption.stat}</span><b>{selectedLoading || selectedError ? "—" : number(totalActivity)}</b><small>in 26 weeks</small></div>
          <div className="ov-stat"><span>Active days</span><b>{selectedLoading || selectedError ? "—" : number(daysWithActivity)}</b>
            <small>of {activeDays.length} days</small></div>
        </div>
      </div>
    </section>
  </div>;
}
