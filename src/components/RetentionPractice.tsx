import { useState } from "react";
import type { CardWithStats, PackWithType } from "../lib/heuresis";
import type { LearningAction } from "../lib/learning";
import "./retention-practice.css";

type Props = {
  card: CardWithStats;
  pack: PackWithType;
  busy: boolean;
  selectedActions: Set<LearningAction>;
  onMark: (actions: LearningAction[]) => Promise<void>;
  onSaveSentence: (text: string) => Promise<void>;
  onNotice: (message: string) => void;
};

/** Optional, deliberate practice. Clicking a label alone never records practice. */
export default function RetentionPractice({ card, busy, selectedActions, onMark, onSaveSentence, onNotice }: Props) {
  const [exercise, setExercise] = useState<"sentence" | "rephrase" | null>(null);
  const [draft, setDraft] = useState("");

  async function complete() {
    if (!exercise || !draft.trim() || busy) return;
    if (exercise === "sentence") await onSaveSentence(draft.trim());
    else await onMark(["rephrase"]);
    setDraft("");
    setExercise(null);
    onNotice(exercise === "sentence" ? "Example saved. Compare it with your own notes for correctness." : "Rephrase practice recorded.");
  }

  return <section className="retention-practice is-revealed" aria-label="Practise more" key={card.id}>
    <div className="retention-actions">
      <button type="button" aria-expanded={exercise === "sentence"} onClick={() => { setExercise(exercise === "sentence" ? null : "sentence"); setDraft(""); }} disabled={busy}>Write a sentence</button>
      <button type="button" aria-expanded={exercise === "rephrase"} onClick={() => { setExercise(exercise === "rephrase" ? null : "rephrase"); setDraft(""); }} disabled={busy}>Rephrase</button>
    </div>
    {exercise ? <form className="retention-panel retention-type-panel" onSubmit={(event) => { event.preventDefault(); void complete(); }}>
      <label htmlFor="review-extra-draft">{exercise === "sentence" ? "Write a sentence using this card" : "Explain the idea in different words"}</label>
      <textarea id="review-extra-draft" value={draft} onChange={(event) => setDraft(event.target.value)}
        rows={2} placeholder="Write your own sentence…" aria-label="Your practice sentence" />
      <div className="retention-extra-buttons">
        <button type="button" onClick={() => { setExercise(null); setDraft(""); }}>Cancel</button>
        <button type="submit" className="primary" disabled={!draft.trim() || busy}>{exercise === "sentence" ? "Save to examples" : "Mark practised"}</button>
      </div>
      {selectedActions.has(exercise) ? <small>Already practised this card in this session.</small> : null}
    </form> : null}
  </section>;
}
