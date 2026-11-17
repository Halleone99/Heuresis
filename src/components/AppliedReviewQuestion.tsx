import { type Exercise, type Verdict } from "../lib/learnExercises";
import { answerMentions } from "../lib/appliedExercises";
import "./applied-review.css";

type Props = {
  exercise: Exercise;
  revealed: boolean;
  verdict: Verdict | null;
  choiceId: string;
  tileIds: string[];
  written: string;
  covered: string[];
  onChoice: (id: string) => void;
  onTiles: (ids: string[]) => void;
  onWritten: (text: string) => void;
  onCovered: (ids: string[]) => void;
};

export default function AppliedReviewQuestion({ exercise, revealed, verdict, choiceId, tileIds, written, covered, onChoice, onTiles, onWritten, onCovered }: Props) {
  return <div className="applied-review-question" aria-label="Applied review question">
    <div className="applied-review-heading"><span>Applied · {exercise.kind.replace(/-/g, " ")}</span><strong>{exercise.prompt.ask}</strong></div>
    <div className={exercise.prompt.style === "case" ? "applied-review-case" : "applied-review-prompt"}>{exercise.prompt.text}</div>
    {exercise.prompt.sub ? <p className="applied-review-sub">{exercise.prompt.sub}</p> : null}
    {exercise.format === "choice" ? <div className="applied-review-choices" role="group" aria-label="Choose an answer">
      {exercise.choices.map((option) => <button type="button" key={option.id} disabled={revealed}
        aria-pressed={choiceId === option.id}
        className={`${choiceId === option.id ? "selected" : ""} ${revealed && option.id === exercise.answerId ? "correct" : ""} ${revealed && choiceId === option.id && option.id !== exercise.answerId ? "incorrect" : ""}`}
        onClick={() => onChoice(option.id)}>{option.label}</button>)}
    </div> : null}
    {exercise.format === "build" ? <div className="applied-review-order">
      <p>Tap the steps in order.</p>
      {tileIds.length ? <div className="applied-review-selected" aria-label="Your step order">{tileIds.map((id, i) => {
        const tile = exercise.tiles.find((item) => item.id === id);
        return <button type="button" key={id} disabled={revealed} onClick={() => onTiles(tileIds.filter((item) => item !== id))}><b>{i + 1}</b>{tile?.text}</button>;
      })}</div> : null}
      {!revealed ? <div className="applied-review-tiles">{exercise.tiles.filter((tile) => !tileIds.includes(tile.id)).map((tile) =>
        <button type="button" key={tile.id} onClick={() => onTiles([...tileIds, tile.id])}>{tile.text}</button>)}</div> : null}
    </div> : null}
    {exercise.format === "judge" ? <div className="applied-review-free">
      <textarea aria-label="Your answer" rows={4} maxLength={900} value={written} disabled={revealed}
        onChange={(event) => onWritten(event.target.value)} placeholder={exercise.placeholder}/>
      {revealed ? <fieldset className="applied-review-selfcheck" disabled={Boolean(verdict)}>
        <legend>Tick only the points present in your written answer</legend>
        {exercise.points.map((point) => <label key={point.id}>
          <input type="checkbox" checked={covered.includes(point.id)} onChange={(event) => onCovered(event.target.checked ? [...covered, point.id] : covered.filter((id) => id !== point.id))} />
          <span><b>{point.label}{point.essential === false ? " · detail" : ""}</b>{point.text}
            {covered.includes(point.id) && !answerMentions(written, point.text) ? <small>Double-check that you actually wrote this point.</small> : null}</span>
        </label>)}
      </fieldset> : null}
    </div> : null}
    {revealed && exercise.format !== "judge" ? <div className="applied-review-answer" role="status"><b>{verdict?.correct ? "Correct" : "Reference answer"}</b><p>{exercise.solution}</p>{verdict?.message ? <small>{verdict.message}</small> : null}</div> : null}
    {revealed && exercise.format === "judge" && verdict ? <div className="applied-review-answer" role="status"><b>{verdict.correct ? "Covered" : "Needs work"}</b><p>{verdict.message || "Compare the answer against your own written explanation."}</p></div> : null}
  </div>;
}
