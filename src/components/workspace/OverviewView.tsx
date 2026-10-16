import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BarChart3, BookOpen, Check, NotebookPen, Pencil, Plus, RefreshCw, Target, Trash2, X } from "lucide-react";
import { entryTitle, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { loadStudyActivity, meaningfulStudySessions, weekStart, type StudyActivity } from "../../lib/activity";
import { languageFromCollection, languageFromName } from "../../lib/languages";
import type { Collection, PackWithType } from "../../lib/heuresis";
import { KindIcon, relativeTime } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export type StudySummary = { cards: number; collections: number; topics: number };
type GoalMap = Record<string, string>;
type Day = { key: string; label: string; date: Date; future: boolean; count: number };
const GOAL_PREFIX = "heuresis.overview.goals.v1:";
const dayKey = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const keyOfName = (name: string) => languageFromName(name) ?? name.trim().toLocaleLowerCase();
const dayFromTimestamp = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dayKey(date) : null;
};

function readGoals(userId: string): GoalMap {
  try {
    const raw = JSON.parse(localStorage.getItem(GOAL_PREFIX + userId) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.length < 120 && typeof value === "string" && value.length <= 160)) as GoalMap;
  } catch { return {}; }
}

function ActivityHeatmap({ activity, filter, packs, collections, entries, subjects, topics, practice, error, loading, onRetry }: {
  activity: StudyActivity | null; filter: string | null; packs: PackWithType[]; collections: Collection[];
  entries: ReturnType<typeof useWorkspace>["snapshot"]["entries"];
  subjects: ReturnType<typeof useWorkspace>["snapshot"]["subjects"];
  topics: ReturnType<typeof useWorkspace>["snapshot"]["topics"];
  practice: ReturnType<typeof useWorkspace>["snapshot"]["practice"];
  error: string; loading: boolean; onRetry: () => void;
}) {
  const { weeks, activeDays, counted, lastDay } = useMemo(() => {
    const subjectById = new Map(subjects.map((row) => [row.id, keyOfName(row.name)]));
    const topicById = new Map(topics.map((row) => [row.id, row.subject_id]));
    const entryById = new Map(entries.map((row) => [row.id, row]));
    const collectionById = new Map(collections.map((row) => [row.id, keyOfName(row.title) === row.title.toLocaleLowerCase() ? (languageFromCollection(row) ?? keyOfName(row.title)) : keyOfName(row.title)]));
    const packById = new Map(packs.map((row) => [row.id, collectionById.get(row.collection_id) ?? null]));
    const matches = (key: string | null | undefined) => !filter || key === filter;
    const add = (value: string | null | undefined, language: string | null | undefined, map: Map<string, number>) => {
      if (!value || !matches(language)) return;
      const key = dayFromTimestamp(value);
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    };
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const key = subjectById.get(topicById.get(entry.topic_id) ?? "");
      add(entry.created_at, key, counts);
      // There is no full note edit audit log. Count only the latest edit, and
      // never twice when the edit and creation occurred on the same local day.
      if (entry.updated_at && dayFromTimestamp(entry.updated_at) !== dayFromTimestamp(entry.created_at)) add(entry.updated_at, key, counts);
    }
    for (const event of practice) {
      const entry = entryById.get(event.record_id);
      const key = entry ? subjectById.get(topicById.get(entry.topic_id) ?? "") : null;
      add(event.created_at, key, counts);
    }
    if (activity) {
      for (const event of activity.reviews) add(event.created_at, packById.get(event.pack_id), counts);
      const withGrades = new Set(activity.reviews.map((row) => row.session_id).filter(Boolean));
      // An ungraded browse session counts once if cards were actually opened.
      // Sessions containing reviews are already represented by those review events.
      for (const session of meaningfulStudySessions(activity.sessions, activity.reviews)) {
        if (!withGrades.has(session.id)) add(session.started_at, packById.get(session.pack_id), counts);
      }
    }
    const start = weekStart(new Date());
    start.setDate(start.getDate() - 25 * 7);
    const today = dayKey(new Date());
    const slots: Day[] = [];
    const weekLabels: { key: string; month: string }[] = [];
    for (let w = 0; w < 26; w += 1) {
      const first = new Date(start);
      first.setDate(first.getDate() + w * 7);
      const prev = new Date(first); prev.setDate(prev.getDate() - 7);
      weekLabels.push({ key: dayKey(first), month: w === 0 || first.getMonth() !== prev.getMonth() ? first.toLocaleDateString("en-GB", { month: "short" }) : "" });
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(first);
        date.setDate(date.getDate() + d);
        const key = dayKey(date);
        slots.push({ key, date, label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), future: key > today, count: counts.get(key) ?? 0 });
      }
    }
    return { weeks: { labels: weekLabels, days: slots }, activeDays: slots.filter((row) => !row.future && row.count > 0).length, counted: slots.filter((row) => !row.future).reduce((sum, row) => sum + row.count, 0), lastDay: today };
  }, [activity, collections, entries, filter, packs, practice, subjects, topics]);

  return <section className="ws-panel ov-activity" aria-labelledby="ov-activity-title">
    <div className="ws-panel-head">
      <h2 id="ov-activity-title">Learning activity</h2>
      <span className="ws-muted ws-tiny">Last 26 weeks · {activeDays} active days</span>
    </div>
    <div className="ov-heat-scroll">
      <div className="ov-heat-layout">
        <div className="ov-heat-months" aria-hidden="true">
          {weeks.labels.map((week) => <span key={week.key}>{week.month}</span>)}
        </div>
        <div className="ov-heat-body">
          <div className="ov-heat-weekdays" aria-hidden="true"><span>M</span><span/><span>W</span><span/><span>F</span><span/><span/></div>
          <div className="ov-heat-grid" role="img" aria-label={loading ? "Loading recorded learning activity" : error ? "Partial learning activity: Study history unavailable" : "Learning activity calendar, 26 weeks"}>
            {weeks.days.map((day) => <span key={day.key} className="ov-heat-cell" data-level={day.future ? "future" : day.count === 0 ? "0" : day.count === 1 ? "1" : day.count <= 4 ? "2" : day.count <= 9 ? "3" : "4"} title={day.future ? day.label : `${day.label}: ${day.count} recorded ${day.count === 1 ? "action" : "actions"}`} />)}
          </div>
        </div>
      </div>
    </div>
    <div className="ov-heat-footer">
      <span>{loading ? "Loading Study activity…" : error ? "Study activity unavailable; only Notebook activity is shown." : `${counted} recorded actions · notes, lessons, recalls and flashcards`}</span>
      {error ? <button type="button" className="nb-link-button" onClick={onRetry}><RefreshCw size={13}/> Retry</button> : null}
      <div className="ov-heat-legend" aria-label="Less to more activity"><span>Less</span>{[0,1,2,3,4].map((n) => <i key={n} className="ov-heat-cell" data-level={String(n)} />)}<span>More</span></div>
    </div>
  </section>;
}

export function OverviewView({ study, onOpenStudy, collections, packs }: {
  study: StudySummary; onOpenStudy: () => void; collections: Collection[]; packs: PackWithType[];
}) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [filter, setFilter] = useState<string | null>(null);
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [goals, setGoals] = useState<GoalMap>(() => readGoals(workspace.userId));
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let alive = true;
    setActivityLoading(true);
    setActivityError("");
    void loadStudyActivity(workspace.userId, 190, retry ? 0 : 60_000)
      .then((value) => { if (alive) setActivity(value); })
      .catch(() => { if (alive) { setActivity(null); setActivityError("unavailable"); } })
      .finally(() => { if (alive) setActivityLoading(false); });
    return () => { alive = false; };
  }, [retry, workspace.userId]);
  useEffect(() => { setGoals(readGoals(workspace.userId)); setEditing(null); }, [workspace.userId]);

  const languages = useMemo(() => {
    const rows = new Map<string, string>();
    for (const subject of snapshot.subjects) rows.set(keyOfName(subject.name), subject.name);
    const existingPacks = new Set(packs.map((pack) => pack.collection_id));
    for (const collection of collections) {
      if (!existingPacks.has(collection.id)) continue;
      const id = languageFromCollection(collection) ?? keyOfName(collection.title);
      if (!rows.has(id)) rows.set(id, languageFromCollection(collection) ? ({ zh: "Chinese", de: "German", ru: "Russian", en: "English", fr: "French", es: "Spanish", it: "Italian", ja: "Japanese", ko: "Korean" } as Record<string, string>)[id] ?? collection.title : collection.title);
    }
    return [...rows].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [collections, packs, snapshot.subjects]);

  const selected = filter && languages.some((row) => row.id === filter) ? filter : null;
  const notes = snapshot.entries.filter((entry) => entry.kind === "note" && entry.category !== "reference" &&
    (!selected || keyOfName(workspace.subjectById.get(workspace.topicById.get(entry.topic_id)?.subject_id ?? "")?.name ?? "") === selected))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);
  const displayedGoals = languages.filter((row) => (!selected || row.id === selected) && goals[row.id]?.trim());
  const currentLabel = selected ? languages.find((row) => row.id === selected)?.name ?? "" : "";

  const saveGoal = (key: string, value: string) => {
    const next = { ...goals };
    if (value.trim()) next[key] = value.trim().slice(0, 160);
    else delete next[key];
    try {
      localStorage.setItem(GOAL_PREFIX + workspace.userId, JSON.stringify(next));
      setGoals(next); setEditing(null); setDraft("");
    } catch { workspace.toast("Goal could not be saved on this device.", { tone: "error" }); }
  };

  return <div className="ov-page ov-simple">
    <header className="ws-page-head">
      <div><span className="ws-eyebrow">Your learning space</span><h1>Overview</h1></div>
    </header>
    {languages.length ? <nav className="ws-chips ov-subjects" aria-label="Filter Overview by language">
      <button type="button" className={!selected ? "is-active" : ""} aria-pressed={!selected} onClick={() => { setFilter(null); setEditing(null); }}>All</button>
      {languages.map((row) => <button type="button" key={row.id} className={selected === row.id ? "is-active" : ""} aria-pressed={selected === row.id} onClick={() => { setFilter(row.id); setEditing(null); }}>{row.name}</button>)}
    </nav> : null}

    <ActivityHeatmap activity={activity} filter={selected} packs={packs} collections={collections} entries={snapshot.entries} subjects={snapshot.subjects} topics={snapshot.topics} practice={snapshot.practice} loading={activityLoading} error={activityError} onRetry={() => setRetry((value) => value + 1)} />

    <div className="ov-simple-grid">
      <section className="ws-panel">
        <div className="ws-panel-head"><h2><NotebookPen size={16}/> Recently edited{currentLabel ? ` · ${currentLabel}` : ""}</h2></div>
        {notes.length ? <ul className="ov-list">{notes.map((entry: KnowledgeEntry) => <li key={entry.id}>
          <button type="button" onClick={() => workspace.openDocument(entry.id)}>
            <span className="ov-icon"><KindIcon entry={entry} size={14}/></span>
            <span className="ov-list-main"><strong>{entryTitle(entry)}</strong><small>{workspace.pathLabel(entry.topic_id)}</small></span>
            <span className="ov-list-meta">{relativeTime(entry.updated_at)}</span>
          </button>
        </li>)}</ul> : <p className="ws-muted">No notes in this selection yet.</p>}
      </section>
      <div className="ov-simple-side">
        <section className="ws-panel">
          <div className="ws-panel-head">
            <h2><Target size={16}/> Objectives</h2>
            {selected && editing !== selected ? <button type="button" className="nb-link-button" onClick={() => { setEditing(selected); setDraft(goals[selected] ?? ""); }}>
              {goals[selected] ? <Pencil size={13}/> : <Plus size={13}/>} {goals[selected] ? "Edit" : "Add goal"}
            </button> : null}
          </div>
          {editing === selected && selected ? <form className="ov-goal-edit" onSubmit={(event) => { event.preventDefault(); saveGoal(selected, draft); }}>
            <label htmlFor="ov-goal-input">Goal for {currentLabel}</label>
            <input id="ov-goal-input" className="ws-input" autoFocus maxLength={160} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What do you want to achieve?"/>
            <div className="ov-goal-actions">
              <button className="ws-button is-small is-primary" type="submit" disabled={!draft.trim()}><Check size={13}/> Save</button>
              <button className="ws-button is-small" type="button" onClick={() => setEditing(null)}><X size={13}/> Cancel</button>
              {Boolean(goals[selected]) ? <button className="ws-button is-small is-quiet" type="button" onClick={() => saveGoal(selected, "")}><Trash2 size={13}/> Remove</button> : null}
            </div>
            <small className="ws-muted">Saved on this device.</small>
          </form> : displayedGoals.length ? <ul className="ov-simple-goals">
            {displayedGoals.map((row) => <li key={row.id}><small>{row.name}</small><span>{goals[row.id]}</span></li>)}
          </ul> : <p className="ws-muted">{selected ? "No goal set for this language." : "Select a language to add a goal."}</p>}
        </section>
        <section className="ws-panel ov-quicklinks">
          <button type="button" onClick={onOpenStudy}><BookOpen size={17}/><span><strong>Study</strong><small>{study.cards.toLocaleString()} cards · {study.topics} topics</small></span><ArrowRight size={16}/></button>
          <button type="button" onClick={() => workspace.goTo("progress")}><BarChart3 size={17}/><span><strong>View progress</strong><small>Detailed learning statistics</small></span><ArrowRight size={16}/></button>
        </section>
      </div>
    </div>
  </div>;
}
