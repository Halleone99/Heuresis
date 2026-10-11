import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BookOpenText, Check, CircleHelp, FolderPlus, GraduationCap, Lightbulb, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  createKnowledgeSubject, createKnowledgeTopic, deleteKnowledgeEntry,
  knowledgeSearchText, loadKnowledge, saveKnowledgeEntry, setKnowledgeMistakeStatus,
  type KnowledgeDraft, type KnowledgeEntry, type KnowledgeKind, type KnowledgeSnapshot,
} from "../lib/knowledgeWorkspace";
import { loadCapturedLanguageEntries, loadLanguageObjectives, type CapturedLanguageEntry, type LanguageObjectivesSnapshot } from "../lib/personalOsLanguageSources";
import { supabase } from "../lib/supabase";
import "./knowledge-workspace.css";

export type WorkspaceSection = "overview" | "study" | "notebook" | "mistakes" | "progress";
const EMPTY: KnowledgeSnapshot = { subjects: [], topics: [], entries: [] };
const SHORT_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const SESSION_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const rememberedTopicKey = "heuresis.knowledge.currentTopic.v1";

function dateLabel(value: string) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? SHORT_DATE.format(d) : "";
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function normalise(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}
function answerKey(text: string) {
  return normalise(text).replace(/[.,!?。！？；;:：]/g, "");
}
function RichInline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  )}</>;
}
function RichNote({ text }: { text: string }) {
  return <div className="kw-note-content">{text.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div className="kw-note-gap" key={index}/>;
    if (trimmed.startsWith("# ")) return <h3 key={index}><RichInline text={trimmed.slice(2)}/></h3>;
    if (trimmed.startsWith("## ")) return <h4 key={index}><RichInline text={trimmed.slice(3)}/></h4>;
    if (/^[-•] /.test(trimmed)) return <div className="kw-note-bullet" key={index}>
      <span aria-hidden="true">•</span><span><RichInline text={trimmed.slice(2)}/></span></div>;
    return <p key={index}><RichInline text={line}/></p>;
  })}</div>;
}
function useKnowledge(userId: string, revision: number) {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setSnapshot(await loadKnowledge(userId)); }
    catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void reload(); }, [reload, revision]);
  return { snapshot, loading, error, reload, setSnapshot };
}

type WorkspaceProps = {
  userId: string;
  mode: Exclude<WorkspaceSection, "study">;
  revision: number;
  onStartCapture: (kind: KnowledgeKind) => void;
  onMode: (mode: WorkspaceSection) => void;
  onTopic: (id: string) => void;
};
export function KnowledgeWorkspace({ userId, mode, revision, onStartCapture, onMode, onTopic }: WorkspaceProps) {
  const { snapshot, loading, error, reload, setSnapshot } = useKnowledge(userId, revision);
  const [topicId, setTopicId] = useState(() => {
    try { return localStorage.getItem(rememberedTopicKey) ?? ""; } catch { return ""; }
  });
  const [query, setQuery] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(rememberedTopicKey);
      if (saved) setTopicId(saved);
    } catch { /* topic stays selected */ }
  }, [revision]);
  const [localError, setLocalError] = useState("");
  const [showRail, setShowRail] = useState(false);
  const [edit, setEdit] = useState<KnowledgeEntry | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [objectives, setObjectives] = useState<LanguageObjectivesSnapshot | null>(null);
  const [legacyCaptures, setLegacyCaptures] = useState<CapturedLanguageEntry[]>([]);
  const [studyStats, setStudyStats] = useState<{ sessions: number; graded: number; lastAt: string | null } | null>(null);
  const subjects = snapshot.subjects;
  const topics = snapshot.topics;
  const entries = snapshot.entries;
  const selectedTopic = topics.find((t) => t.id === topicId) ?? topics[0] ?? null;
  const selectedSubject = subjects.find((s) => s.id === selectedTopic?.subject_id);
  const topicCount = useMemo(() => {
    const result = new Map<string, { notes: number; mistakes: number; pending: number }>();
    for (const e of entries) {
      const row = result.get(e.topic_id) ?? { notes: 0, mistakes: 0, pending: 0 };
      if (e.kind === "note") row.notes++;
      else { row.mistakes++; if (e.status === "needs_practice") row.pending++; }
      result.set(e.topic_id, row);
    }
    return result;
  }, [entries]);
  const pending = entries.filter((e) => e.kind === "mistake" && e.status === "needs_practice");
  const totalMistakes = entries.filter((e) => e.kind === "mistake").length;
  const totalNotes = entries.filter((e) => e.kind === "note").length;
  const allSearchEntries = useMemo(() => {
    const q = normalise(query);
    if (!q) return [];
    return entries.filter((e) => {
      const topic = topics.find((t) => t.id === e.topic_id);
      const subject = subjects.find((s) => s.id === topic?.subject_id);
      return q.split(" ").every((word) => knowledgeSearchText(e, topic, subject).includes(word));
    }).slice(0, 100);
  }, [entries, query, topics, subjects]);
  const shown = entries.filter((e) => e.topic_id === selectedTopic?.id && e.kind === (mode === "mistakes" ? "mistake" : "note"))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sortedSubjects = [...subjects].sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  useEffect(() => {
    if (!selectedTopic) { onTopic(""); return; }
    onTopic(selectedTopic.id);
    try { localStorage.setItem(rememberedTopicKey, selectedTopic.id); } catch { /* optional preference */ }
  }, [selectedTopic?.id, onTopic]);
  useEffect(() => {
    if (mode !== "overview" && mode !== "progress") return;
    let cancelled = false;
    void loadLanguageObjectives(userId).then((data) => { if (!cancelled) setObjectives(data); }).catch(() => undefined);
    if (mode === "progress" && supabase) {
      const client = supabase;
      void Promise.all([
        client.from("heuresis_sessions").select("started_at").eq("user_id", userId)
          .order("started_at", { ascending: false }).limit(2000),
        client.from("heuresis_card_events").select("event_type").eq("user_id", userId).limit(5000),
      ]).then(([sessions, grades]) => {
        if (cancelled || sessions.error || grades.error) return;
        setStudyStats({
          sessions: sessions.data?.length ?? 0,
          graded: grades.data?.filter((g) => ["again","hard","good","easy"].includes(g.event_type)).length ?? 0,
          lastAt: sessions.data?.[0]?.started_at ?? null,
        });
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [mode, userId, revision]);
  async function addSubject() {
    const value = window.prompt("New subject (for example, Chinese)");
    if (!value?.trim()) return;
    try {
      setLocalError("");
      const created = await createKnowledgeSubject(userId, value);
      setSnapshot((current) => ({ ...current, subjects: [...current.subjects, created] }));
      const firstTopic = await createKnowledgeTopic(userId, created.id, "Inbox");
      setSnapshot((current) => ({ ...current, topics: [...current.topics, firstTopic] }));
      setTopicId(firstTopic.id);
    } catch (err) { setLocalError(message(err)); void reload(); }
  }
  async function addTopic(subjectId: string) {
    const value = window.prompt("New topic name");
    if (!value?.trim()) return;
    try {
      setLocalError("");
      const created = await createKnowledgeTopic(userId, subjectId, value);
      setSnapshot((current) => ({ ...current, topics: [...current.topics, created] }));
      setTopicId(created.id);
    } catch (err) { setLocalError(message(err)); }
  }
  async function changeStatus(entry: KnowledgeEntry) {
    const status = entry.status === "understood" ? "needs_practice" : "understood";
    try {
      await setKnowledgeMistakeStatus(userId, entry.id, status);
      setSnapshot((current) => ({ ...current, entries: current.entries.map((e) =>
        e.id === entry.id ? { ...e, status } : e) }));
    } catch (err) { setLocalError(message(err)); }
  }
  async function removeEntry(entry: KnowledgeEntry) {
    if (!window.confirm("Delete this " + entry.kind + "? This cannot be undone.")) return;
    try {
      await deleteKnowledgeEntry(userId, entry.id);
      setSnapshot((current) => ({ ...current, entries: current.entries.filter((e) => e.id !== entry.id) }));
    } catch (err) { setLocalError(message(err)); }
  }
  function startPractice(entry: KnowledgeEntry) {
    setChecking(entry.id); setAnswer(""); setRevealed(false);
  }
  const activeGoals = objectives?.objectives.filter((o) => o.status === "active") ?? [];
  useEffect(() => {
    let cancelled = false;
    void loadCapturedLanguageEntries(userId).then((items) => {
      if (!cancelled) setLegacyCaptures(items);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId, revision]);
  const legacyHere = legacyCaptures.filter((item) => normalise(item.subject ?? "") === normalise(selectedSubject?.name ?? ""));

  return <div className="kw-root">
    {(mode === "notebook" || mode === "mistakes") && <aside className={"kw-rail " + (showRail ? "kw-rail-open" : "")}>
      <div className="kw-rail-top"><span>SUBJECTS</span><button title="New subject" onClick={() => void addSubject()}><Plus size={16}/></button></div>
      {sortedSubjects.map((subject) => <div key={subject.id} className="kw-subject">
        <div className="kw-subject-line"><strong>{subject.name}</strong><button title={"New topic in " + subject.name} onClick={() => void addTopic(subject.id)}><Plus size={14}/></button></div>
        {topics.filter((t) => t.subject_id === subject.id).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}))
          .map((topic) => <button key={topic.id} className={"kw-topic " + (topic.id === selectedTopic?.id ? "selected" : "")}
            onClick={() => { setTopicId(topic.id); setShowRail(false); setQuery(""); }}>
            <span>{topic.name}</span>
            <small>{topicCount.get(topic.id)?.pending ? "● " + topicCount.get(topic.id)?.pending : (topicCount.get(topic.id)?.notes ?? 0) + (topicCount.get(topic.id)?.mistakes ?? 0) || ""}</small>
          </button>)}
      </div>)}
      {!subjects.length && <p className="kw-muted">Add a subject to organise your knowledge.</p>}
    </aside>}
    <section className="kw-body">
      <div className="kw-upper">
        <div>
          <span className="kw-eyebrow">{mode === "overview" ? "LEARNING WORKSPACE" : mode === "progress" ? "YOUR ACTIVITY" : selectedSubject?.name ?? "KNOWLEDGE"}</span>
          <h1>{mode === "overview" ? "Overview" : mode === "progress" ? "Progress" : selectedTopic?.name ?? (mode === "mistakes" ? "Mistake Log" : "Notebook")}</h1>
          {mode === "overview" && <p>One place to capture what you encounter, understand it, and return to it.</p>}
        </div>
        <div className="kw-actions">
          {(mode === "notebook" || mode === "mistakes") && <button className="kw-small-rail-button" onClick={() => setShowRail((v) => !v)}>Subjects</button>}
          <button className="kw-primary" onClick={() => onStartCapture(mode === "mistakes" ? "mistake" : "note")}><Plus size={15}/> Capture</button>
        </div>
      </div>
      {loading && <div className="kw-state">Loading notes and topics…</div>}
      {(error || localError) && <div className="kw-error" role="alert">{error || localError}<button onClick={() => { setLocalError(""); void reload(); }}>Retry</button></div>}
      {!loading && !error && mode === "overview" && <>
        <div className="kw-metrics">
          <div><span>Notes</span><strong>{totalNotes}</strong></div>
          <div><span>Mistakes to revisit</span><strong>{pending.length}</strong></div>
          <div><span>Knowledge topics</span><strong>{topics.length}</strong></div>
        </div>
        <div className="kw-panel">
          <h2>Worth revisiting</h2>
          {pending.length ? pending.slice(0,5).map((e) => <button key={e.id} className="kw-return-row" onClick={() => {
            setTopicId(e.topic_id); onMode("mistakes"); startPractice(e);
          }}><CircleHelp size={15}/><span>{e.title || e.attempt}</span><small>Practise →</small></button>)
            : <p className="kw-muted">No mistakes currently marked for practice. Capture a difficult example when you encounter one.</p>}
        </div>
        {legacyCaptures.length > 0 && <div className="kw-panel"><h2>Earlier captures in Personal OS</h2>
          <p className="kw-muted">Read-only, not duplicated or imported. These are notes you previously captured in the Personal OS language workspace.</p>
          {legacyCaptures.slice(0, 6).map((item) => <div key={item.id} className="kw-legacy-row">
            <span>{item.subject ?? "Language"} · {dateLabel(item.created_at)}</span>
            <strong>{item.front}</strong>{item.back && <p>{item.back}</p>}{item.third_side && <small>{item.third_side}</small>}
          </div>)}
        </div>}
        <div className="kw-panel">
          <h2>Language objectives</h2>
          {activeGoals.length ? activeGoals.slice(0,6).map((goal) => {
            const language = objectives?.languages.find((l) => l.id === goal.languageId)?.name ?? "Language";
            return <div key={goal.id} className="kw-goal-row"><span>{language} · {goal.title}</span>
              <small>{goal.kind === "counted" ? goal.current + " / " + goal.target + " " + goal.unit : goal.steps.filter((s) => s.done).length + " / " + goal.steps.length + " steps"}</small></div>;
          }) : <p className="kw-muted">No active language objectives in the Personal OS cloud snapshot.</p>}
        </div>
      </>}
      {!loading && !error && (mode === "notebook" || mode === "mistakes") && <>
        <div className="kw-tabs">
          <button className={mode === "notebook" ? "active" : ""} onClick={() => onMode("notebook")}>Notes <small>{topicCount.get(selectedTopic?.id ?? "")?.notes ?? 0}</small></button>
          <button className={mode === "mistakes" ? "active" : ""} onClick={() => onMode("mistakes")}>Mistakes <small>{topicCount.get(selectedTopic?.id ?? "")?.mistakes ?? 0}</small></button>
          <span>{topicCount.get(selectedTopic?.id ?? "")?.pending ? topicCount.get(selectedTopic?.id ?? "")?.pending + " to practise" : ""}</span>
        </div>
        <div className="kw-search"><Search size={15}/><input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search topics, notes and corrections…" aria-label="Search knowledge" /></div>
        {query.trim() ? <div className="kw-results">
          <span className="kw-eyebrow">SEARCH RESULTS · {allSearchEntries.length}{allSearchEntries.length === 100 ? "+" : ""}</span>
          {allSearchEntries.map((e) => { const topic = topics.find((t) => t.id === e.topic_id); return <button key={e.id} onClick={() => {
            setTopicId(e.topic_id); onMode(e.kind === "note" ? "notebook" : "mistakes"); setQuery("");
          }}><span>{e.kind === "mistake" ? "Correction" : "Note"} · {topic?.name}</span>
            <strong>{e.title || (e.kind === "note" ? e.body : e.attempt).slice(0,110)}</strong></button>; })}
          {!allSearchEntries.length && <p className="kw-muted">No matching entries.</p>}
        </div> : <>
          {!selectedTopic && <div className="kw-state"><BookOpenText size={24}/><p>Create a subject and topic to get started.</p>
            <button className="kw-primary" onClick={() => void addSubject()}><Plus size={14}/> New subject</button></div>}
          {selectedTopic && !shown.length && <div className="kw-state"><Lightbulb size={24}/>
            <p>No {mode === "notebook" ? "notes" : "mistakes"} in this topic yet.</p>
            <button className="kw-primary" onClick={() => onStartCapture(mode === "mistakes" ? "mistake" : "note")}>
              <Plus size={14}/> Add {mode === "notebook" ? "a note" : "a mistake"}</button></div>}
          {mode === "notebook" && legacyHere.length > 0 && <details className="kw-legacy"><summary>Earlier captures from Personal OS ({legacyHere.length})</summary>
            <p className="kw-muted">These remain in their original Personal OS records until a deliberate migration is implemented.</p>
            {legacyHere.map((item) => <div key={item.id} className="kw-legacy-row">
              <span>{dateLabel(item.created_at)} · {item.entry_type}</span><strong>{item.front}</strong>
              {item.back && <p>{item.back}</p>}{item.third_side && <small>{item.third_side}</small>}
            </div>)}
          </details>}
          {shown.map((e) => <article key={e.id} className="kw-entry">
            <div className="kw-entry-top"><span className="kw-eyebrow">{e.kind === "note" ? "NOTE" : "MISTAKE"}</span>
              <div className="kw-entry-controls"><small>{dateLabel(e.created_at)}</small><button title="Edit entry" onClick={() => setEdit(e)}><Pencil size={14}/></button>
                <button title="Delete entry" onClick={() => void removeEntry(e)}><Trash2 size={14}/></button></div></div>
            {e.title && <h2>{e.title}</h2>}
            {e.kind === "note" ? <RichNote text={e.body}/> : <>
              <div className="kw-comparison"><div><span>YOUR ATTEMPT</span><p>{e.attempt}</p></div>
                <div><span>CORRECTION</span><p>{e.correction}</p></div></div>
              {e.explanation && <p className="kw-why"><span>WHY</span>{e.explanation}</p>}
              <div className="kw-entry-footer">
                <button className={e.status === "needs_practice" ? "kw-pending" : "kw-understood"}
                  onClick={() => void changeStatus(e)}>{e.status === "needs_practice" ? "● Needs practice" : "✓ Understood (self-assessed)"}</button>
                <button className="kw-practice-button" onClick={() => startPractice(e)}><GraduationCap size={14}/> Test recall</button>
              </div>
              {checking === e.id && <div className="kw-practice">
                <strong>Retrieve the corrected sentence from memory</strong>
                <p>Try writing the correct version before revealing the answer.</p>
                <textarea value={answer} onChange={(event) => { setAnswer(event.target.value); setRevealed(false); }}
                  placeholder="Your answer…" rows={2}/>
                <div className="kw-practice-actions"><button onClick={() => setRevealed(true)}>Reveal / check</button>
                  <button onClick={() => setChecking(null)}>Close</button></div>
                {revealed && <div className="kw-practice-result">
                  <span>{answerKey(answer) && answerKey(answer) === answerKey(e.correction) ? "Exact match (punctuation ignored)." : "Compare your answer with the correction:"}</span>
                  <strong>{e.correction}</strong>
                  <small>One correct attempt is practice, not proof of long-term retention.</small>
                </div>}
              </div>}
            </>}
          </article>)}
        </>}
      </>}
      {!loading && !error && mode === "progress" && <>
        <p className="kw-muted">Activity from Heuresis is shown separately from Anki Tracker, which remains in Personal OS.</p>
        <div className="kw-metrics">
          <div><span>Heuresis sessions</span><strong>{studyStats?.sessions ?? "—"}</strong></div>
          <div><span>Graded card responses</span><strong>{studyStats?.graded ?? "—"}</strong></div>
          <div><span>Last session</span><strong className="kw-date-metric">{studyStats?.lastAt ? SESSION_DATE.format(new Date(studyStats.lastAt)) : "—"}</strong></div>
        </div>
        <div className="kw-panel"><h2>Notes and corrections</h2>
          <div className="kw-metrics kw-metrics-inline">
            <div><span>Notes captured</span><strong>{totalNotes}</strong></div>
            <div><span>Mistakes recorded</span><strong>{totalMistakes}</strong></div>
            <div><span>Needs practice</span><strong>{pending.length}</strong></div>
          </div>
          <p className="kw-muted">These are activity counts, not a score of understanding. Genuine retention needs successful retrieval over time.</p>
        </div>
      </>}
    </section>
    {edit && <EntryComposer userId={userId} initialKind={edit.kind} initialTopicId={edit.topic_id}
      existing={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }}/>}
  </div>;
}

type ComposerProps = { userId: string; initialKind: KnowledgeKind; initialTopicId: string;
  onClose: () => void; onSaved: () => void; existing?: KnowledgeEntry };
export function EntryComposer({ userId, initialKind, initialTopicId, onClose, onSaved, existing }: ComposerProps) {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [topicId, setTopicId] = useState(existing?.topic_id ?? initialTopicId);
  const [newSubject, setNewSubject] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [draft, setDraft] = useState<KnowledgeDraft>({
    kind: existing?.kind ?? initialKind, topicId: existing?.topic_id ?? initialTopicId,
    title: existing?.title ?? "", body: existing?.body ?? "",
    attempt: existing?.attempt ?? "", correction: existing?.correction ?? "",
    explanation: existing?.explanation ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let disposed = false;
    void loadKnowledge(userId).then((data) => {
      if (disposed) return;
      setSnapshot(data);
      const chosen = data.topics.find((t) => t.id === (existing?.topic_id || initialTopicId));
      const first = chosen ?? data.topics[0];
      if (first) { setTopicId(first.id); setSubjectId(first.subject_id); }
      else { setTopicId("__new__"); setSubjectId(data.subjects[0]?.id ?? "__new__"); setNewTopic("Inbox"); }
    }).catch((err) => { if (!disposed) setError(message(err)); })
      .finally(() => { if (!disposed) setLoading(false); });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => { disposed = true; window.removeEventListener("keydown", escape); };
  }, [userId, initialTopicId, existing?.id]);
  function patch(field: keyof KnowledgeDraft, value: string) {
    setDraft((valueBefore) => ({ ...valueBefore, [field]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    try {
      let targetId = topicId;
      if (targetId === "__new__" || !targetId) {
        let parent = subjectId;
        if (parent === "__new__" || !parent) {
          const created = await createKnowledgeSubject(userId, newSubject);
          parent = created.id;
        }
        const created = await createKnowledgeTopic(userId, parent, newTopic || "Inbox");
        targetId = created.id;
      }
      if (existing && existing.kind !== draft.kind) throw new Error("An entry type cannot be changed on edit.");
      await saveKnowledgeEntry(userId, { ...draft, topicId: targetId }, existing?.id);
      try { localStorage.setItem(rememberedTopicKey, targetId); } catch { /* optional */ }
      onSaved();
    } catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  }
  const subjects = [...snapshot.subjects].sort((a,b) => a.name.localeCompare(b.name));
  const topics = snapshot.topics.filter((t) => !subjectId || t.subject_id === subjectId)
    .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  return <div className="kw-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="kw-composer" onSubmit={(event) => void save(event)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault(); event.currentTarget.requestSubmit();
        }
      }} aria-label={existing ? "Edit knowledge entry" : "Quick knowledge capture"}>
      <div className="kw-composer-head">
        <div className="kw-kind-switch">
          <button type="button" disabled={Boolean(existing)} className={draft.kind === "note" ? "active" : ""}
            onClick={() => patch("kind", "note")}>Note</button>
          <button type="button" disabled={Boolean(existing)} className={draft.kind === "mistake" ? "active" : ""}
            onClick={() => patch("kind", "mistake")}>Mistake</button>
        </div><button type="button" aria-label="Close" onClick={onClose}><X size={18}/></button>
      </div>
      {loading ? <p className="kw-muted">Loading topics…</p> : <div className="kw-composer-content">
        <div className="kw-selects">
          {topicId !== "__new__" && <label>Topic
            <select value={topicId} onChange={(e) => {
              setTopicId(e.target.value);
              const topic = snapshot.topics.find((t) => t.id === e.target.value);
              if (topic) setSubjectId(topic.subject_id);
            }}>
              {snapshot.topics.map((t) => {
                const subject = snapshot.subjects.find((s) => s.id === t.subject_id);
                return <option key={t.id} value={t.id}>{subject?.name ?? "Subject"} / {t.name}</option>;
              })}
              <option value="__new__">+ New topic…</option>
            </select></label>}
          {topicId === "__new__" && <>
            <label>Subject <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__new__">+ New subject…</option>
            </select></label>
            {subjectId === "__new__" && <label>Subject name<input required maxLength={120} value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)} placeholder="Chinese, German…" /></label>}
            <label>Topic name<input required maxLength={120} value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)} placeholder="Inbox or a grammar topic" /></label>
          </>}
          {topicId !== "__new__" && <button type="button" className="kw-new-topic" onClick={() => {
            setTopicId("__new__");
            setNewTopic("Inbox");
          }}><FolderPlus size={14}/> New topic</button>}
        </div>
        <label>Title <small>optional</small><input maxLength={200} value={draft.title}
          onChange={(e) => patch("title", e.target.value)} placeholder={draft.kind === "note" ? "What did you learn?" : "The error or rule"}/></label>
        {draft.kind === "note" ? <label>Capture <small>**bold** · # heading · - bullet</small><textarea autoFocus required rows={6} maxLength={50000} value={draft.body}
          onChange={(e) => patch("body", e.target.value)} placeholder="A new expression, a question, a grammar rule… Organise it later." /></label>
          : <>
            <label>What I wrote or thought<textarea autoFocus required maxLength={5000} rows={3} value={draft.attempt}
              onChange={(e) => patch("attempt", e.target.value)} placeholder="Your original attempt"/></label>
            <label>Correct version<textarea required rows={3} maxLength={5000} value={draft.correction}
              onChange={(e) => patch("correction", e.target.value)} placeholder="The corrected sentence"/></label>
            <label>Why it was wrong <small>optional</small><textarea rows={2} maxLength={10000} value={draft.explanation}
              onChange={(e) => patch("explanation", e.target.value)} placeholder="The rule or misunderstanding"/></label>
          </>}
        {error && <p className="kw-error" role="alert">{error}</p>}
      </div>}
      <div className="kw-composer-footer">
        <small>Ctrl/⌘ + Enter to save · clarify later</small>
        <button type="button" className="kw-cancel" onClick={onClose}>Cancel</button>
        <button type="submit" className="kw-primary" disabled={loading || saving}>
          <Check size={15}/>{saving ? "Saving…" : existing ? "Save changes" : "Save capture"}
        </button>
      </div>
    </form>
  </div>;
}
