import { Link2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { LEARNING_ACTION_LABELS, type LearningAction, type LearningCounts } from "../lib/learning";
import type { ReviewMethod } from "../lib/reviewPrefs";
import { type StudyTemplate } from "../lib/study";
import ConnectionsPanel from "./ConnectionsPanel";
import "./retention-practice.css";

type Props = {
  card: CardWithStats;
  pack: PackWithType;
  template: StudyTemplate | null;
  revealed: boolean;
  busy: boolean;
  counts: LearningCounts;
  selectedActions: Set<LearningAction>;
  /** The session's answering method (chosen once, changeable during Review). */
  method: ReviewMethod;
  typed: string;
  onTyped: (value: string) => void;
  /** Enter in the typed answer reveals the card. */
  onSubmitTyped: () => void;
  onMark: (actions: LearningAction[]) => Promise<void>;
  onNotice: (message: string) => void;
};

/** Extra ways of practising a card, recorded independently of the result. */
const EXTRA_ACTIONS: LearningAction[] = ["sentence", "rephrase", "example", "handwrite", "say"];

function speechLanguage(text: string, pack: PackWithType) {
  if (/\p{Script=Han}/u.test(text)) return "zh-CN";
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru-RU";
  const name = `${pack.title} ${pack.cardType?.name ?? ""}`.toLocaleLowerCase();
  if (/german|deutsch/.test(name)) return "de-DE";
  if (/french|français|francais/.test(name)) return "fr-FR";
  if (/italian|italiano/.test(name)) return "it-IT";
  if (/spanish|español|espanol/.test(name)) return "es-ES";
  return "en-GB";
}

export default function RetentionPractice({
  card, pack, template, revealed, busy, counts, selectedActions, method, typed, onTyped, onSubmitTyped, onMark, onNotice,
}: Props) {
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  useEffect(() => {
    setConnectionsOpen(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [card.id]);

  const speechText = useMemo(() => {
    // Before reveal, audio must never leak a hidden answer: read only the active
    // direction's visible front (or the term for legacy templates without one).
    for (const key of template?.front ?? []) {
      const value = fieldText(card.data, key);
      if (value) return value;
    }
    const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
    return fieldText(card.data, term?.key);
  }, [card, pack, template]);

  async function hear() {
    if (busy) return;
    if (!speechText) { onNotice("There is no visible prompt text that Heuresis can read aloud."); return; }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { onNotice("Text-to-speech is not available in this window."); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = speechLanguage(speechText, pack);
    window.speechSynthesis.speak(utterance);
    await onMark(["hear"]);
  }

  // Listening first: the prompt is read out when the card appears.
  useEffect(() => {
    if (method === "hear" && !revealed) void hear();
    // Only when a new card appears in listening mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, method]);

  const count = (action: LearningAction) => counts[action] ? <small>×{counts[action]}</small> : null;

  if (revealed) {
    return <section className="retention-practice is-revealed" aria-label="Also practised">
      <div className="retention-actions">
        <span>ALSO PRACTISED</span>
        {EXTRA_ACTIONS.filter((action) => !(action === method)).map((action) => <button key={action} type="button" aria-pressed={selectedActions.has(action)} disabled={busy || selectedActions.has(action)}
          onClick={() => void onMark(action === "sentence" || action === "rephrase" || action === "example" ? ["handwrite", action] : [action])}>{LEARNING_ACTION_LABELS[action]}{count(action)}</button>)}
        <button type="button" onClick={() => setConnectionsOpen(true)}><Link2 size={13} /> Connections</button>
      </div>
      {connectionsOpen ? <ConnectionsPanel pack={pack} card={card} onClose={() => setConnectionsOpen(false)} /> : null}
    </section>;
  }

  return <section className="retention-practice" aria-label="Answer">
    {method === "type" ? <form className="retention-panel retention-type-panel" onSubmit={(event) => { event.preventDefault(); onSubmitTyped(); }}>
      <textarea
        autoFocus
        rows={1}
        value={typed}
        aria-label="Type your answer"
        onChange={(event) => onTyped(event.target.value)}
        onKeyDown={(event) => {
          // Enter also confirms an input-method candidate (pinyin, kana): never reveal then.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onSubmitTyped(); }
        }}
        placeholder="Type your answer, then Enter to reveal"
      />
    </form> : null}
    <div className="retention-actions">
      <button type="button" disabled={busy} onClick={() => void hear()} title="Read the prompt aloud"><Volume2 size={13} /> Hear{count("hear")}</button>
    </div>
  </section>;
}
