import { Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { type LearningAction, type LearningCounts } from "../lib/learning";
import { compareAttempt, dictationExpected, recordDictationAttempt, speechLanguage, type DiffSegment } from "../lib/dictation";
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
  onMark: (actions: LearningAction[]) => Promise<void>;
  onNotice: (message: string) => void;
  dictation: boolean;
  sessionId: string | null;
  onRevealRequest: () => Promise<void>;
};

type PracticePanel = "handwrite" | "type" | null;
type HandwriteAction = Extract<LearningAction, "sentence" | "rephrase" | "example">;

const HANDWRITE_OPTIONS: Array<{ action: HandwriteAction; label: string }> = [
  { action: "sentence", label: "Sentence" },
  { action: "rephrase", label: "Rephrase" },
  { action: "example", label: "Own example" },
];

export default function RetentionPractice({
  card,
  pack,
  template,
  revealed,
  busy,
  counts,
  selectedActions,
  onMark,
  onNotice,
  dictation,
  sessionId,
  onRevealRequest,
}: Props) {
  const [panel, setPanel] = useState<PracticePanel>(dictation ? "type" : null);
  const [typedAttempt, setTypedAttempt] = useState("");
  const [submittedAttempt, setSubmittedAttempt] = useState("");
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  useEffect(() => {
    setPanel(dictation ? "type" : null);
    setTypedAttempt("");
    setSubmittedAttempt("");
    setConnectionsOpen(false);
    if (!dictation && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, [card.id, dictation]);

  const speechText = useMemo(() => {
    const type = pack.cardType;
    const term = fieldByRole(type, "term") ?? type?.field_schema[0] ?? null;
    const direct = fieldText(card.data, term?.key);
    if (direct) return direct;
    for (const key of template?.back ?? []) {
      const value = fieldText(card.data, key);
      if (value) return value;
    }
    for (const key of template?.front ?? []) {
      const value = fieldText(card.data, key);
      if (value) return value;
    }
    return "";
  }, [card, pack, template]);

  const expected = useMemo(
    () => dictation ? dictationExpected(card, pack.cardType, template) : null,
    [card, pack.cardType, template, dictation],
  );

  const comparison = useMemo(
    () => expected && submittedAttempt ? compareAttempt(expected.text, submittedAttempt, expected.script) : null,
    [expected, submittedAttempt],
  );

  const verdictCopy = (segments: DiffSegment[]) => segments.map((segment, position) => (
    <span key={`${segment.kind}-${position}`} className={`retention-diff-${segment.kind}`}>{segment.text}</span>
  ));

  const count = (action: LearningAction) => counts[action] ? <small>×{counts[action]}</small> : null;

  async function chooseHandwrite(action: HandwriteAction) {
    if (busy) return;
    await onMark(["handwrite", action]);
    setPanel(null);
  }

  async function submitType() {
    const value = typedAttempt.trim();
    if (!value || busy) return;
    setSubmittedAttempt(value);
    if (dictation) {
      if (expected) {
        void recordDictationAttempt({
          cardId: card.id,
          packId: pack.id,
          sessionId,
          templateId: template?.id ?? null,
          expected: expected.text,
          attempt: value,
          verdict: compareAttempt(expected.text, value, expected.script).verdict,
        }).catch(() => undefined);
      }
      setPanel(null);
      await onRevealRequest();
      return;
    }
    await onMark(["type"]);
    setPanel(null);
  }

  async function markSay() {
    if (busy) return;
    await onMark(["say"]);
    onNotice("Say the answer aloud before you reveal it.");
  }

  async function hear() {
    if (busy) return;
    if (!speechText) {
      onNotice("There is no text on this card that Heuresis can read aloud.");
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onNotice("Text-to-speech is not available in this window.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = speechLanguage(speechText, pack);
    window.speechSynthesis.speak(utterance);
    await onMark(["hear"]);
  }

  if (revealed) {
    return <>
      {submittedAttempt ? <div className="retention-typed-compare" data-verdict={comparison?.verdict}>
        <small>{comparison ? `YOUR ANSWER · ${comparison.verdict === "exact" ? "matches" : comparison.verdict === "close" ? "close" : "differs"}${expected ? ` · checked against ${expected.label}` : ""}` : "YOUR TYPED ANSWER"}</small>
        <p>{submittedAttempt}</p>
        {comparison && comparison.verdict !== "exact" && comparison.segments.length
          ? <p className="retention-diff">{verdictCopy(comparison.segments)}</p>
          : null}
      </div> : null}
      <div className="retention-revealed-tools"><button type="button" onClick={() => setConnectionsOpen(true)}><Link2 size={13} /> Connections</button></div>
      {connectionsOpen ? <ConnectionsPanel pack={pack} card={card} onClose={() => setConnectionsOpen(false)} /> : null}
    </>;
  }

  return <section className="retention-practice" aria-label="Retention practice">
    {dictation ? null : <div className="retention-actions">
      <span>RETENTION</span>
      <button
        type="button"
        aria-pressed={selectedActions.has("handwrite")}
        aria-expanded={panel === "handwrite"}
        disabled={busy}
        onClick={() => setPanel((current) => current === "handwrite" ? null : "handwrite")}
      >Hand-write{count("handwrite")}</button>
      <button
        type="button"
        aria-pressed={selectedActions.has("type")}
        aria-expanded={panel === "type"}
        disabled={busy}
        onClick={() => setPanel((current) => current === "type" ? null : "type")}
      >Type{count("type")}</button>
      <button type="button" aria-pressed={selectedActions.has("say")} disabled={busy} onClick={() => void markSay()}>Say aloud{count("say")}</button>
      <button type="button" aria-pressed={selectedActions.has("hear")} disabled={busy} onClick={() => void hear()}>Hear{count("hear")}</button>
    </div>}

    {panel === "handwrite" ? <div className="retention-panel retention-handwrite-panel">
      <span>HAND-WRITE AS</span>
      {HANDWRITE_OPTIONS.map(({ action, label }) => <button
        key={action}
        type="button"
        aria-pressed={selectedActions.has(action)}
        disabled={busy}
        onClick={() => void chooseHandwrite(action)}
      >{label}{count(action)}</button>)}
    </div> : null}

    {panel === "type" ? <form className="retention-panel retention-type-panel" onSubmit={(event) => { event.preventDefault(); void submitType(); }}>
      <textarea
        autoFocus
        rows={2}
        value={typedAttempt}
        onChange={(event) => setTypedAttempt(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submitType(); }
        }}
        placeholder={dictation ? "Write what you heard…" : "Type your answer before revealing the card…"}
      />
      <div>
        <button type="button" disabled={busy} onClick={() => setPanel(null)}>Cancel</button>
        <button className="primary" type="submit" disabled={busy || !typedAttempt.trim()}>Done</button>
      </div>
    </form> : null}
  </section>;
}
