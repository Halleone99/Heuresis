import { useEffect, useState, type FormEvent } from "react";
import { loadLatestReviewCorrection, type ReviewCorrection, type ReviewCorrectionGrade } from "../lib/reviewCorrections";
import { RESULT_LABEL } from "../lib/reviewResults";

type Props = {
  grade: ReviewCorrectionGrade;
  initialAttempt: string;
  referenceAnswer: string;
  onSave: (id: string, attempt: string, explanation: string) => Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
};

export default function ReviewCorrectionPanel({ grade, initialAttempt, referenceAnswer, onSave, onSkip, onCancel }: Props) {
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
      setError(reason instanceof Error ? reason.message : "Could not save the correction.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return <form className="cosmos-correction" onSubmit={onSubmit} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!saving) onCancel(); }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit(); }
  }}>
    <div className="cosmos-correction-heading">
      <strong>Record this {RESULT_LABEL[grade].toLowerCase()} answer</strong>
      <span>Your explanation will be saved with this card in Supabase.</span>
    </div>
    <div className="cosmos-correction-fields">
      <label><span>What I answered or confused it with</span>
        <textarea value={attempt} onChange={(event) => setAttempt(event.target.value)}
          rows={2} maxLength={3000} placeholder="What did you think the answer was? (If nothing came to mind, leave blank.)" autoFocus />
      </label>
      <div className="cosmos-correction-reference"><span>Correct answer</span><p>{referenceAnswer}</p></div>
      <label className="cosmos-correction-reason"><span>Why it is different · what I need to remember</span>
        <textarea value={explanation} onChange={(event) => setExplanation(event.target.value)}
          rows={3} maxLength={3000} placeholder="Explain the confusion in your own words…" required />
      </label>
    </div>
    {error ? <p className="cosmos-correction-error" role="alert">{error}</p> : null}
    <div className="cosmos-correction-actions">
      <button type="button" disabled={saving} onClick={onCancel}>Back to ratings</button>
      <button type="button" disabled={saving} onClick={onSkip} title="Record the review grade without a written correction">Skip note</button>
      <button className="cosmos-correction-save" type="submit" disabled={saving || !explanation.trim()}>{saving ? "Saving…" : "Save correction & continue"}</button>
    </div>
  </form>;
}

export function PreviousReviewCorrection({ cardId, templateId }: { cardId: string; templateId: string | null }) {
  const [previous, setPrevious] = useState<ReviewCorrection | null>(null);
  useEffect(() => {
    let current = true;
    setPrevious(null);
    void loadLatestReviewCorrection(cardId, templateId)
      .then((value) => { if (current) setPrevious(value); })
      .catch(() => undefined); // Historical note availability must never block grading.
    return () => { current = false; };
  }, [cardId, templateId]);
  if (!previous) return null;
  return <details className="cosmos-previous-correction">
    <summary>Earlier correction · {new Date(previous.created_at).toLocaleDateString()}</summary>
    <div className="cosmos-previous-correction-body">
      {previous.attempt ? <p><b>I answered</b> {previous.attempt}</p> : <p><b>I could not recall an answer.</b></p>}
      <p><b>Correct</b> {previous.reference_answer}</p>
      <p><b>Why</b> {previous.explanation}</p>
    </div>
  </details>;
}
