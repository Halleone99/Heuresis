import { useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { checkCaptureText, type ProofreadingSuggestion } from "../lib/aiCheck";
import { comparableCorrection, createEntry, createSubject, createTopic, loadKnowledge, recordRepeatedMistake } from "../lib/knowledgeWorkspace";
import { signalWorkspaceChange } from "../lib/workspaceSignal";
import { supabase } from "../lib/supabase";
import "./retention-practice.css";

type Props = {
  card: CardWithStats;
  pack: PackWithType;
  revealed: boolean;
  busy: boolean;
  onSaveSentence: (text: string) => Promise<void>;
  onNotice: (message: string) => void;
};

/** An exercise is separate from the answer method: draft first, check after reveal. */
export default function RetentionPractice({ card, pack, revealed, busy, onSaveSentence, onNotice }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState("");
  const [suggestions, setSuggestions] = useState<ProofreadingSuggestion[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [logged, setLogged] = useState(false);

  const checked = suggestions !== null && reviewed === draft;
  const corrections = checked ? suggestions : [];
  const corrected = corrections.reduce((text, suggestion) => {
    return text.split(suggestion.original).length === 2
      ? text.replace(suggestion.original, suggestion.replacement) : text;
  }, draft);
  const hasCorrections = checked && corrections.length > 0 && corrected !== draft;

  function updateDraft(value: string) {
    setDraft(value);
    setSaved(false);
    setLogged(false);
    setError("");
  }

  async function checkWithAI() {
    if (!revealed || !draft.trim() || checking || saving || busy) return;
    const submitted = draft;
    setChecking(true);
    setError("");
    setSuggestions(null);
    try {
      // The existing authenticated proofreading endpoint is called only on request.
      const target = fieldText(card.data, fieldByRole(pack.cardType, "term")?.key);
      const result = await checkCaptureText(submitted, pack.title, "exercise", target);
      setReviewed(submitted);
      setSuggestions(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI checking is unavailable.");
    } finally {
      setChecking(false);
    }
  }

  async function saveExample() {
    if (!checked || !draft.trim() || saving || busy) return;
    setSaving(true);
    setError("");
    try {
      await onSaveSentence(corrected.trim());
      setSaved(true);
      onNotice("Example saved to this card. AI checking is advisory, not a guarantee.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the example.");
    } finally {
      setSaving(false);
    }
  }

  async function addToMistakeLog() {
    if (!hasCorrections || logged || saving || checking || busy) return;
    setSaving(true);
    setError("");
    try {
      if (!supabase) throw new Error("Sign in to save a mistake.");
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data.user) throw new Error("Sign in to save a mistake.");
      const userId = data.user.id;
      const { snapshot } = await loadKnowledge(userId);
      // Keep the optional exercise out of other subject trees until the learner files it.
      // Use Mistake Log's existing Not filed convention: Unsorted / Inbox.
      let subject = snapshot.subjects.find((entry) => entry.name.trim().toLowerCase() === "unsorted");
      if (!subject) subject = await createSubject(userId, "Unsorted");
      let topic = snapshot.topics.find((entry) => entry.subject_id === subject.id && entry.name.trim().toLowerCase() === "inbox");
      if (!topic) topic = await createTopic(userId, subject.id, "Inbox");

      const previous = snapshot.entries.find((entry) => entry.kind === "mistake" && entry.topic_id === topic.id
        && comparableCorrection(entry.attempt) === comparableCorrection(draft)
        && comparableCorrection(entry.correction) === comparableCorrection(corrected));
      if (previous) {
        await recordRepeatedMistake(userId, previous);
      } else {
        await createEntry(userId, {
          kind: "mistake",
          topicId: topic.id,
          title: "Review exercise · " + pack.title,
          attempt: draft,
          correction: corrected,
          explanation: corrections.map((item) => item.reason).filter(Boolean).join("\n"),
        });
      }
      signalWorkspaceChange(userId);
      setLogged(true);
      onNotice(previous ? "This mistake was already saved. Its recurrence was recorded." : "Added to Mistake Log · Not filed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the mistake.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="retention-practice cosmos-example-exercise" aria-label="Exercise">
    <div className="retention-actions">
      <span className="retention-label">Exercise</span>
      <button type="button" aria-expanded={open} aria-controls="review-example-exercise"
        onClick={() => setOpen((value) => !value)} disabled={busy}>Type example</button>
    </div>
    {open ? <div id="review-example-exercise" className="retention-panel retention-type-panel">
      <label htmlFor="review-extra-draft">Use the expression or idea in your own sentence.</label>
      <textarea id="review-extra-draft" value={draft} onChange={(event) => updateDraft(event.target.value)}
        rows={3} maxLength={4000} placeholder="Write an original example…" aria-label="Your example sentence" />
      {!revealed ? <small>Write now. The AI check becomes available once you reveal the card.</small> : <>
        <div className="retention-extra-buttons">
          <button type="button" disabled={!draft.trim() || checking || saving || busy} onClick={() => void checkWithAI()}>
            {checking ? "Checking…" : checked ? "Check again with AI" : "Check example with AI"}
          </button>
        </div>
        {checked ? <div className="retention-ai-feedback" role="status">
          {corrections.length === 0 ? <p>No clear errors found. AI can miss mistakes.</p> : <>
            <strong>Suggested corrections · review before saving</strong>
            {corrections.map((item, index) => <div className="retention-ai-change" key={index}>
              <p><del>{item.original}</del> → <ins>{item.replacement}</ins></p>
              <small>{item.reason}</small>
            </div>)}
            <div className="retention-ai-preview"><small>Proposed corrected example</small><p>{corrected}</p></div>
          </>}
          <div className="retention-extra-buttons">
            <button type="button" disabled={saving || saved || busy} onClick={() => void saveExample()}>
              {saved ? "Saved to examples ✓" : hasCorrections ? "Save corrected example" : "Save to examples"}
            </button>
            {hasCorrections ? <button type="button" disabled={saving || logged || busy} onClick={() => void addToMistakeLog()}>
              {logged ? "Added to Mistake Log ✓" : "Add to Mistake Log"}
            </button> : null}
          </div>
          {hasCorrections ? <small>Suggestions are not automatically treated as mistakes. You choose whether to record them.</small> : null}
        </div> : null}
      </>}
      {error ? <p className="retention-ai-error" role="alert">{error}</p> : null}
    </div> : null}
  </section>;
}
