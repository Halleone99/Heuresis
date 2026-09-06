import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import {
  finishStudySession,
  loadStudySetup,
  recordStudyEvent,
  startHeuresisSession,
  type StudyGrade,
  type StudyTemplate,
} from "../lib/study";

export type CatalogueSessionItem = { card: CardWithStats; pack: PackWithType };
type Mode = "browse" | "review";
type SessionInfo = { id: string; template: StudyTemplate | null };

type Props = {
  title: string;
  items: CatalogueSessionItem[];
  mode: Mode;
  onClose: () => void;
  templateByPackId?: Record<string, string>;
};

export default function CatalogueSession({ title, items, mode, onClose, templateByPackId }: Props) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(mode === "browse");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sessions = useRef(new Map<string, SessionInfo>());
  const current = items[index] ?? null;
  const info = current ? sessions.current.get(current.pack.id) ?? null : null;
  const forcedTemplateKey = Object.entries(templateByPackId ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([packId, templateId]) => `${packId}:${templateId}`).join("|");

  const closeSessions = useCallback(async () => {
    const open = Array.from(sessions.current.values());
    sessions.current.clear();
    await Promise.all(open.map((session) => finishStudySession(session.id).catch(() => undefined)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const uniquePacks = Array.from(new Map(items.map((item) => [item.pack.id, item.pack])).values());
        for (const pack of uniquePacks) {
          let template: StudyTemplate | null = null;
          if (mode === "review") {
            const setup = await loadStudySetup(pack.id, pack.card_type_id);
            const forcedId = templateByPackId?.[pack.id];
            template = (forcedId ? setup.templates.find((item) => item.id === forcedId) : null)
              ?? setup.templates.find((item) => item.id === setup.defaultTemplateId)
              ?? setup.templates[0]
              ?? null;
            if (!template) throw new Error(`${pack.title} has no review direction.`);
          }
          const id = await startHeuresisSession(pack.id, mode === "review" ? "flashcards" : "browse", template?.id ?? null);
          if (cancelled) { await finishStudySession(id).catch(() => undefined); return; }
          sessions.current.set(pack.id, { id, template });
        }
        if (mode === "review" && items[0]) {
          const first = sessions.current.get(items[0].pack.id);
          if (first) await recordStudyEvent({ cardId: items[0].card.id, packId: items[0].pack.id, sessionId: first.id, templateId: first.template?.id ?? null, eventType: "encountered" });
        }
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : "Could not open this catalogue session.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; void closeSessions(); };
  }, [closeSessions, forcedTemplateKey, items, mode]);

  const template = info?.template ?? null;
  const term = current ? fieldByRole(current.pack.cardType, "term") ?? current.pack.cardType?.field_schema[0] ?? null : null;
  const reading = current ? fieldByRole(current.pack.cardType, "reading") : null;
  const meaning = current ? fieldByRole(current.pack.cardType, "meaning") ?? current.pack.cardType?.field_schema[1] ?? null : null;
  const displayKeys = useMemo(() => {
    if (!current) return [] as string[];
    if (mode === "browse") return [term?.key, reading?.key, meaning?.key].filter((key): key is string => Boolean(key));
    const selected = revealed ? [...(template?.back ?? []), ...(template?.details ?? [])] : (template?.front ?? []);
    return selected.length ? Array.from(new Set(selected)) : (revealed ? [meaning?.key] : [term?.key, reading?.key]).filter((key): key is string => Boolean(key));
  }, [current, meaning?.key, mode, reading?.key, revealed, template, term?.key]);

  async function move(nextIndex: number) {
    const bounded = Math.max(0, Math.min(items.length, nextIndex));
    if (mode === "review" && bounded < items.length && bounded !== index) {
      const next = items[bounded];
      const nextSession = sessions.current.get(next.pack.id);
      if (nextSession) await recordStudyEvent({ cardId: next.card.id, packId: next.pack.id, sessionId: nextSession.id, templateId: nextSession.template?.id ?? null, eventType: "encountered" });
    }
    setIndex(bounded);
    setRevealed(mode === "browse");
  }

  async function reveal() {
    if (!current || !info || revealed || mode !== "review") return;
    await recordStudyEvent({ cardId: current.card.id, packId: current.pack.id, sessionId: info.id, templateId: template?.id ?? null, eventType: "revealed" });
    setRevealed(true);
  }

  async function answer(grade: StudyGrade) {
    if (!current || !info || !revealed || mode !== "review") return;
    await recordStudyEvent({ cardId: current.card.id, packId: current.pack.id, sessionId: info.id, templateId: template?.id ?? null, eventType: grade });
    await move(index + 1);
  }

  async function close() {
    await closeSessions();
    onClose();
  }

  if (loading) return <div className="immersive-layer"><div className="content-state">Opening catalogue session…</div></div>;
  if (error) return <div className="immersive-layer"><div className="content-state error-state">{error}<button onClick={() => void close()}>Close</button></div></div>;
  if (!current) return <div className="immersive-layer"><div className="content-state"><strong>Catalogue complete.</strong><p>{items.length} cards.</p><button className="primary-button" onClick={() => void close()}>Return</button></div></div>;

  return <div className="immersive-layer browse-layer">
    <header className="immersive-bar"><span><b>{title}</b> · {mode === "review" ? "Review" : "Browse"} · {index + 1} / {items.length}</span><button onClick={() => void close()}><X size={16} /> Close</button></header>
    <main className="browse-stage"><article className="browse-card">
      <div className="browse-main"><p className="eyebrow">{current.pack.title}</p>{displayKeys.map((key, position) => {
        const value = fieldText(current.card.data, key);
        if (!value) return null;
        const field = current.pack.cardType?.field_schema.find((item) => item.key === key);
        if (field?.role === "term" || position === 0) return <h1 key={key}>{value}</h1>;
        if (field?.role === "reading") return <h2 key={key}>{value}</h2>;
        return <div className="browse-meaning" key={key}>{value}</div>;
      })}</div>
      {current.card.tags.length ? <div className="browse-tags">{current.card.tags.map((tag) => <span className={tag.is_badge ? "badge" : ""} key={tag.id}>{tag.name}</span>)}</div> : null}
      {current.card.note ? <aside>{current.card.note}</aside> : null}
      {mode === "review" && !revealed ? <button className="primary-button reveal-button" onClick={() => void reveal()}>Reveal</button> : null}
    </article></main>
    <footer className="immersive-controls">
      {mode === "browse" ? <>
        <button className="secondary-button" disabled={index === 0} onClick={() => void move(index - 1)}><ArrowLeft size={15} /> Previous</button>
        <span>Browsing does not change encounter statistics</span>
        <button className="primary-button" onClick={() => void move(index + 1)}>{index >= items.length - 1 ? "Finish" : <>Next <ArrowRight size={15} /></>}</button>
      </> : revealed ? <>
        <button onClick={() => void answer("again")}>Again · 1</button><button onClick={() => void answer("hard")}>Hard · 2</button><button className="primary-button" onClick={() => void answer("good")}>Good · 3</button><button onClick={() => void answer("easy")}>Easy · 4</button>
      </> : <span>Reveal before grading.</span>}
    </footer>
  </div>;
}
