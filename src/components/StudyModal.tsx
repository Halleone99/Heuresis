import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Shuffle, X } from "lucide-react";
import { fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import {
  finishStudySession,
  loadStudySetup,
  recordStudyEvent,
  startStudySession,
  type StudyGrade,
  type StudyTemplate,
} from "../lib/study";
import "./study.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  onClose: () => void;
  onComplete: () => void;
};

type Phase = "launch" | "review" | "done";
type CountChoice = "10" | "20" | "50" | "all";

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function StudyFields({ keys, card, className = "" }: { keys: string[]; card: CardWithStats; className?: string }) {
  const values = keys.map((key) => ({ key, value: fieldText(card.data, key) })).filter((item) => item.value.trim());
  if (!values.length) return null;
  return <div className={className}>{values.map((item) => <div key={item.key}>{item.value}</div>)}</div>;
}

export default function StudyModal({ pack, cards, onClose, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("launch");
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [countChoice, setCountChoice] = useState<CountChoice>(cards.length <= 10 ? "all" : "20");
  const [randomOrder, setRandomOrder] = useState(false);
  const [queue, setQueue] = useState<CardWithStats[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);
  const current = queue[index] ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadStudySetup(pack.id, pack.card_type_id)
      .then(({ templates: next, defaultTemplateId }) => {
        if (cancelled) return;
        setTemplates(next);
        setTemplateId(defaultTemplateId && next.some((item) => item.id === defaultTemplateId) ? defaultTemplateId : next[0]?.id ?? "");
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load study templates."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id]);

  async function start() {
    if (!template || !cards.length || busy) return;
    setBusy(true); setError("");
    const count = countChoice === "all" ? cards.length : Math.min(Number(countChoice), cards.length);
    const chosen = (randomOrder ? shuffled(cards) : [...cards]).slice(0, count);
    try {
      const nextSessionId = await startStudySession(pack.id, template.id);
      try {
        await recordStudyEvent({ cardId: chosen[0].id, packId: pack.id, sessionId: nextSessionId, templateId: template.id, eventType: "encountered" });
      } catch (eventError) {
        await finishStudySession(nextSessionId).catch(() => undefined);
        throw eventError;
      }
      setQueue(chosen); setIndex(0); setRevealed(false); setSessionId(nextSessionId); setPhase("review");
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Could not start review."); }
    finally { setBusy(false); }
  }

  async function reveal() {
    if (!current || !template || !sessionId || revealed || busy) return;
    setBusy(true); setError("");
    try {
      await recordStudyEvent({ cardId: current.id, packId: pack.id, sessionId, templateId: template.id, eventType: "revealed" });
      setRevealed(true);
    } catch (revealError) { setError(revealError instanceof Error ? revealError.message : "Could not record reveal."); }
    finally { setBusy(false); }
  }

  async function grade(value: StudyGrade) {
    if (!current || !template || !sessionId || !revealed || busy) return;
    setBusy(true); setError("");
    try {
      await recordStudyEvent({ cardId: current.id, packId: pack.id, sessionId, templateId: template.id, eventType: value });
      const nextIndex = index + 1;
      if (nextIndex >= queue.length) {
        const finishedId = sessionId;
        setSessionId(null);
        await finishStudySession(finishedId);
        setPhase("done");
        onComplete();
      } else {
        const nextCard = queue[nextIndex];
        await recordStudyEvent({ cardId: nextCard.id, packId: pack.id, sessionId, templateId: template.id, eventType: "encountered" });
        setIndex(nextIndex); setRevealed(false);
      }
    } catch (gradeError) { setError(gradeError instanceof Error ? gradeError.message : "Could not save review action."); }
    finally { setBusy(false); }
  }

  async function close() {
    if (busy) return;
    const activeSession = sessionId;
    setSessionId(null);
    if (activeSession) await finishStudySession(activeSession).catch(() => undefined);
    onClose();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); void close(); return; }
      if (phase !== "review" || busy) return;
      if (!revealed && (event.key === " " || event.key === "Enter")) { event.preventDefault(); void reveal(); return; }
      if (revealed) {
        const grades: Record<string, StudyGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        const value = grades[event.key];
        if (value) { event.preventDefault(); void grade(value); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="study-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) void close(); }}>
      <section className="study-modal" role="dialog" aria-modal="true">
        <header className="study-topbar">
          <div><span className="eyebrow">FLASHCARDS</span><strong>{pack.title}</strong></div>
          {phase === "review" ? <span className="study-progress">{index + 1} / {queue.length}</span> : null}
          <button className="study-close" onClick={() => void close()} aria-label="Close review"><X size={18} /></button>
        </header>

        {phase === "launch" ? <div className="study-launch">
          <div><p className="eyebrow">REVIEW</p><h2>Choose how to enter the topic.</h2><p>The session writes into the existing Heuresis encounter and review history.</p></div>
          {loading ? <div className="study-state">Loading templates…</div> : null}
          {!loading && !templates.length ? <div className="study-state">No study template exists for this card structure yet.</div> : null}
          {!loading && templates.length ? <div className="study-options">
            <label>Template<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Cards<select value={countChoice} onChange={(event) => setCountChoice(event.target.value as CountChoice)}>{[10,20,50].filter((count) => cards.length >= count).map((count) => <option key={count} value={String(count)}>{count} cards</option>)}<option value="all">All loaded · {cards.length}</option></select></label>
            <button className={`study-order ${randomOrder ? "selected" : ""}`} onClick={() => setRandomOrder((value) => !value)}><Shuffle size={15} /> {randomOrder ? "Random order" : "Topic order"}</button>
          </div> : null}
          {error ? <div className="study-error">{error}</div> : null}
          <button className="study-start" disabled={loading || !template || !cards.length || busy} onClick={() => void start()}>Start review <ArrowRight size={16} /></button>
        </div> : null}

        {phase === "review" && current && template ? <div className="study-review">
          <div className="study-card">
            <StudyFields keys={template.front} card={current} className="study-front" />
            {!revealed ? <button className="study-reveal" disabled={busy} onClick={() => void reveal()}>{busy ? "Saving…" : "Reveal"}<span>Space / Enter</span></button> : <>
              <div className="study-divider" />
              <StudyFields keys={template.back} card={current} className="study-back" />
              <StudyFields keys={template.details} card={current} className="study-details" />
              {current.note ? <div className="study-note">{current.note}</div> : null}
              {current.tags.length ? <div className="study-tags">{current.tags.map((tag) => <span key={tag.id}>{tag.name}</span>)}</div> : null}
            </>}
          </div>
          {error ? <div className="study-error">{error}</div> : null}
          {revealed ? <div className="study-grades"><button disabled={busy} onClick={() => void grade("again")}><b>1</b> Again</button><button disabled={busy} onClick={() => void grade("hard")}><b>2</b> Hard</button><button disabled={busy} onClick={() => void grade("good")}><b>3</b> Good</button><button disabled={busy} onClick={() => void grade("easy")}><b>4</b> Easy</button></div> : null}
        </div> : null}

        {phase === "done" ? <div className="study-done"><Check size={28} /><p className="eyebrow">SESSION COMPLETE</p><h2>{queue.length} cards reviewed.</h2><p>The session and grades are already saved to the same Heuresis history used by Personal OS.</p><button className="study-start" onClick={() => void close()}>Return to topic</button></div> : null}
      </section>
    </div>
  );
}
