import { useEffect, useState, type FormEvent } from "react";
import { loadReviewCorrections, type ReviewCorrection } from "../lib/reviewCorrections";

type Props = {
  initialAttempt: string;
  referenceAnswer: string;
  onSave: (id: string, attempt: string, explanation: string) => Promise<void>;
  onCancel: () => void;
};

/** Optional, inline reflection AFTER the grade has already been recorded. */
export default function ReviewCorrectionPanel({ initialAttempt, referenceAnswer, onSave, onCancel }: Props) {
  const [id] = useState(() => crypto.randomUUID());
  const [attempt, setAttempt] = useState(initialAttempt);
  const [explanation, setExplanation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (saving || !explanation.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave(id, attempt, explanation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the explanation.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return <form className="cosmos-correction" onSubmit={onSubmit} onKeyDown={(event) => {
    if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); }
  }}>
    <div className="cosmos-correction-heading">
      <strong>Why wrong?</strong>
      <span>A short note for next time. The review result is already recorded.</span>
    </div>
    <div className="cosmos-correction-fields">
      <label><span>What I thought</span>
        <textarea value={attempt} onChange={(event) => setAttempt(event.target.value)}
          rows={2} maxLength={3000} placeholder="What did I confuse it with?" autoFocus/>
      </label>
      <div className="cosmos-correction-reference"><span>Correct answer</span><p>{referenceAnswer}</p></div>
      <label className="cosmos-correction-reason"><span>Why it was wrong · what to remember</span>
        <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)}
          rows={2} maxLength={3000} placeholder="The distinction I need to remember…" required/>
      </label>
    </div>
    {error ? <p className="cosmos-correction-error" role="alert">{error}</p> : null}
    <div className="cosmos-correction-actions">
      <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
      <button className="cosmos-correction-save" type="submit" disabled={saving || !explanation.trim()}>
        {saving ? "Saving…" : "Save explanation"}
      </button>
    </div>
  </form>;
}

/** Only mounted after a fresh Missed/Partial grade, never on answer reveal. */
export function PreviousReviewCorrection({ cardId, templateId }: { cardId: string; templateId: string | null }) {
  const [history, setHistory] = useState<ReviewCorrection[]>([]);
  useEffect(() => {
    let current = true;
    setHistory([]);
    void loadReviewCorrections(cardId, templateId)
      .then((value) => { if (current) setHistory(value); })
      .catch(() => undefined); // A network failure cannot block a review.
    return () => { current = false; };
  }, [cardId, templateId]);
  if (!history.length) return null;
  return <details className="cosmos-previous-correction">
    <summary>Earlier explanations · {history.length}</summary>
    <div className="cosmos-previous-correction-body">
      {history.map((entry) => <article key={entry.id} className="cosmos-correction-history-entry">
        <small>{new Date(entry.created_at).toLocaleString()}</small>
        <p><b>I thought</b>{entry.attempt || "No answer came to mind"}</p>
        <p><b>Correct</b>{entry.reference_answer}</p>
        <p><b>Remember</b>{entry.explanation}</p>
      </article>)}
    </div>
  </details>;
}
