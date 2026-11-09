import { useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Brain, Check, CheckCircle2, Pencil, Volume2, X } from "lucide-react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import {
  EXERCISE_IDS, acquisitionReady, acquisitionScore, awardExercise, finishAcquisition,
  inLearning, readAcquisition, saveAcquisition, type ExerciseId,
} from "../lib/learningStage";
import "./learning-session.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  onClose: () => void;
  onChanged: () => void;
};

const EXERCISES: Array<{ id: ExerciseId; title: string; detail: string }> = [
  { id: "typing", title: "Type the word", detail: "Copy the spelling accurately" },
  { id: "handwriting", title: "Write by hand", detail: "Trace its shape yourself" },
  { id: "reconstruct", title: "Reconstruct", detail: "Put the letters in order" },
  { id: "missing", title: "Missing letters", detail: "Complete the written form" },
  { id: "meaning", title: "Meaning", detail: "Connect form and meaning" },
  { id: "context", title: "Context", detail: "Consider when it is used" },
  { id: "pronunciation", title: "Say it aloud", detail: "Practise the sound" },
  { id: "contrast", title: "Compare", detail: "Distinguish a similar word" },
  { id: "sentence", title: "Make a sentence", detail: "Use the word yourself" },
  { id: "association", title: "Your association", detail: "Give it a personal link" },
];

const OBJECTIVE: ExerciseId[] = ["typing", "reconstruct", "missing", "meaning"];
const readable = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase();

function segments(value: string) {
  return Array.from(value.normalize("NFC"));
}
function languageOf(pack: PackWithType) {
  const title = pack.title.toLocaleLowerCase();
  if (/chinese|mandarin|中文|汉语|漢語|hsk/.test(title)) return "zh-CN";
  if (/russian|русск/.test(title)) return "ru-RU";
  if (/german|deutsch/.test(title)) return "de-DE";
  if (/french|français/.test(title)) return "fr-FR";
  return "en-GB";
}

export default function LearningSession({ pack, cards, onClose, onChanged }: Props) {
  const [local, setLocal] = useState(() => cards.filter(inLearning));
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState<ExerciseId | null>(null);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const [inked, setInked] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const card = local[Math.min(index, Math.max(0, local.length - 1))] ?? null;
  const state = card ? readAcquisition(card.data) : null;
  const score = state ? acquisitionScore(state) : 0;
  const ready = state ? acquisitionReady(state) : false;
  const termRole = fieldByRole(pack.cardType, "term");
  const meaningRole = fieldByRole(pack.cardType, "meaning");
  const exampleRole = fieldByRole(pack.cardType, "example");
  const term = card ? fieldText(card.data, termRole?.key) || Object.values(card.data).find((s) => typeof s === "string" && s && !s.startsWith("{")) || "" : "";
  const meaning = card ? fieldText(card.data, meaningRole?.key) : "";
  const example = card ? fieldText(card.data, exampleRole?.key) : "";
  const reference = term.trim();
  const letters = segments(reference);
  const ordered = useMemo(() => letters.map((_, i) => i).reverse(), [reference]);
  const reconstructed = selected.map((i) => letters[i]).join("");
  const mask = letters.map((char, i) => char.trim() && (i % 3 === 1 || (letters.length < 3 && i === 0)) ? "＿" : char).join("");
  const alternatives = useMemo(() => {
    if (!card) return [] as string[];
    const others = cards.filter((item) => item.id !== card.id).map((item) => fieldText(item.data, meaningRole?.key).trim())
      .filter((value) => value && readable(value) !== readable(meaning));
    const unique = [...new Map(others.map((value) => [readable(value), value])).values()];
    if (!meaning.trim() || unique.length < 2) return [] as string[];
    return [unique[0], meaning, unique[1]].sort((a, b) => a.localeCompare(b));
  }, [card?.id, cards, meaning, meaningRole?.key]);
  const comparison = cards.find((item) => item.id !== card?.id && fieldText(item.data, termRole?.key).trim()) ?? null;
  const prepared = local.filter((item) => acquisitionReady(readAcquisition(item.data)));
  const reviewed = local.filter((item) => !inLearning(item)).length;

  function chooseExercise(id: ExerciseId) {
    if (state?.completed.includes(id) || busy) return;
    setActive(id); setInput(""); setSelected([]); setError(""); setInked(false);
    canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 170);
  }
  async function credit(id: ExerciseId, verification: "automatic" | "self", evidence: string) {
    if (!card || !state || busy || state.completed.includes(id)) return;
    setBusy(true); setError("");
    try {
      const next = awardExercise(state, id, verification, evidence);
      const saved = await saveAcquisition(card, next);
      setLocal((all) => all.map((item) => item.id === saved.id ? saved : item));
      onChanged();
      setActive(null); setInput(""); setSelected([]); setInked(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save the exercise. Try again.");
    } finally { setBusy(false); }
  }
  async function submit() {
    if (!active || !card) return;
    if (OBJECTIVE.includes(active)) {
      if (active === "meaning" && alternatives.length) {
        if (readable(input) !== readable(meaning)) { setError("Not quite. Compare the meaning above, then try again."); return; }
        await credit(active, "automatic", input);
        return;
      }
      if (active !== "meaning" && readable(active === "reconstruct" ? reconstructed : input) !== readable(reference)) {
        setError("Check the word above and correct the spelling before continuing.");
        return;
      }
      if (active === "meaning" && input.trim().length < 4) { setError("Describe the meaning before confirming."); return; }
      await credit(active, active === "meaning" ? "self" : "automatic", active === "reconstruct" ? reconstructed : input);
      return;
    }
    if (active === "handwriting") {
      if (!inked) { setError("Write on the canvas before confirming."); return; }
      await credit(active, "self", "Handwritten on the canvas");
      return;
    }
    if (active === "pronunciation") { await credit(active, "self", "Pronunciation practised aloud"); return; }
    if (input.trim().length < 5) { setError("Add a short answer or association first."); return; }
    await credit(active, "self", input);
  }
  function stroke(event: PointerEvent<HTMLCanvasElement>, first = false) {
    if (!drawing.current && !first) return;
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (el.width / rect.width);
    const y = (event.clientY - rect.top) * (el.height / rect.height);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#5f9ee3";
    if (first) { ctx.beginPath(); ctx.moveTo(x, y); setInked(true); el.setPointerCapture(event.pointerId); }
    else { ctx.lineTo(x, y); ctx.stroke(); }
  }
  function speak() {
    if (!("speechSynthesis" in window) || !reference) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reference);
    utterance.lang = languageOf(pack); utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }
  async function transferReady() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      // Sequential writes: a failure never results in a false claim that every card moved.
      for (const item of prepared) {
        const saved = await saveAcquisition(item, finishAcquisition(readAcquisition(item.data)));
        setLocal((all) => all.map((row) => row.id === saved.id ? saved : row));
      }
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Some cards could not be transferred.");
    } finally { setBusy(false); }
  }
  function nextCard(direction: number) {
    setActive(null); setInput(""); setSelected([]); setError(""); setInked(false);
    setIndex((n) => Math.min(Math.max(n + direction, 0), Math.max(0, local.length - 1)));
  }

  return createPortal(<div className="acq-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="acq-dialog" role="dialog" aria-modal="true" aria-label="Learning exercises">
      <header className="acq-top">
        <div><span className="acq-kicker">HEURESIS · LEARNING</span><strong>{pack.title}</strong></div>
        <span className="acq-counter">{finished ? "Session complete" : `${index + 1} / ${local.length}`}</span>
        <button className="acq-icon" type="button" disabled={busy} onClick={onClose} aria-label="Close Learning"><X size={17}/></button>
      </header>
      {finished || !card ? <div className="acq-finish">
        <CheckCircle2 size={29} />
        <h2>Learning session complete</h2>
        <p>{prepared.length} of {local.length} cards reached the 100-point target. No cards move until you choose.</p>
        <div className="acq-final-actions">
          <button type="button" className="acq-primary" disabled={!prepared.length || busy} onClick={() => void transferReady()}>
            {busy ? "Saving…" : `Send ${prepared.length} ready ${prepared.length === 1 ? "card" : "cards"} to Review`} <ArrowRight size={15}/>
          </button>
          <button type="button" onClick={onClose} disabled={busy}>Leave remaining in Learning</button>
          {local.length && !reviewed ? <button type="button" onClick={() => { setFinished(false); setIndex(0); }}>Continue exercises</button> : null}
        </div>
        {reviewed > 0 ? <p className="acq-success">{reviewed} moved to Review during this session.</p> : null}
        {error ? <p role="alert" className="acq-error">{error}</p> : null}
      </div> : <>
        <div className="acq-content">
          <div className="acq-card-head">
            <div><h2>{reference || "Untitled card"}</h2>{meaning ? <p>{meaning}</p> : <p>Study this card's meaning and context</p>}</div>
            <div className={ready ? "acq-points is-ready" : "acq-points"}><strong>{score}</strong><span>/ 100</span></div>
          </div>
          <div className="acq-meter" aria-label={`Learning progress ${score} of 100 points`}><i style={{ width: `${score}%` }} className={ready ? "is-ready" : ""}/></div>
          <div className="acq-ready" aria-live="polite">{ready ? <><CheckCircle2 size={14}/> Ready for Review · available at session end</> : `${100 - score} points remaining · +10 per different exercise`}</div>
          <div className="acq-grid" aria-label="Choose an exercise">
            {EXERCISES.map((exercise, pos) => <button key={exercise.id} type="button" disabled={busy || state?.completed.includes(exercise.id)}
              className={`acq-choice${active === exercise.id ? " active" : ""}${state?.completed.includes(exercise.id) ? " complete" : ""}`}
              onClick={() => chooseExercise(exercise.id)}>
              <span className="acq-number">{state?.completed.includes(exercise.id) ? <Check size={13}/> : String(pos + 1).padStart(2, "0")}</span>
              <strong>{exercise.title}</strong><small>{state?.completed.includes(exercise.id) ? "+10 earned" : exercise.detail}</small>
            </button>)}
          </div>
          {active ? <div className="acq-exercise" key={card.id + active}>
            <div className="acq-exercise-head"><div><span className="acq-kicker">EXERCISE</span><h3>{EXERCISES.find((item) => item.id === active)?.title}</h3></div>
              <button type="button" className="acq-icon" onClick={() => { setActive(null); setError(""); }} aria-label="Close exercise"><X size={15}/></button></div>
            {active === "typing" ? <p>Type <b>{reference}</b> exactly as shown.</p> : null}
            {active === "missing" ? <p>Fill in the missing characters: <b className="acq-missing">{mask}</b></p> : null}
            {active === "meaning" ? <p>{alternatives.length ? "Which meaning matches the word above?" : "Explain the meaning in your own words, using the definition above as a guide."}</p> : null}
            {active === "context" ? <p>{example ? <>Consider this example: <em>{example}</em> Describe a situation where it makes sense.</> : "Describe a situation where you would naturally use this word."}</p> : null}
            {active === "contrast" ? <p>{comparison ? <>Compare with <b>{fieldText(comparison.data, termRole?.key)}</b>{fieldText(comparison.data, meaningRole?.key) ? ` (${fieldText(comparison.data, meaningRole?.key)})` : ""}. What is the difference?</> : "Compare this with another word you know. What makes this one different?"}</p> : null}
            {active === "sentence" ? <p>Write a short natural sentence using this word.</p> : null}
            {active === "association" ? <p>Write a personal association, image or mnemonic connecting this word to its meaning.</p> : null}
            {active === "pronunciation" ? <div className="acq-pronunciation"><p>Listen if playback is available. Say the word aloud, then confirm that you practised.</p><button type="button" onClick={speak} disabled={!("speechSynthesis" in window)}><Volume2 size={15}/> Play pronunciation</button></div> : null}
            {active === "handwriting" ? <div className="acq-ink"><p>Write <b>{reference}</b> on the canvas, then confirm your practice.</p>
              <canvas ref={canvas} width={600} height={170} aria-label="Handwriting practice canvas"
                onPointerDown={(event) => { drawing.current = true; stroke(event, true); }}
                onPointerMove={(event) => stroke(event)}
                onPointerUp={() => { drawing.current = false; }}
                onPointerCancel={() => { drawing.current = false; }}/>
              <button type="button" onClick={() => { canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 170); setInked(false); }}>Clear writing</button></div> : null}
            {active === "reconstruct" ? <div className="acq-reconstruct"><p>Arrange the characters to make <b>{reference}</b>.</p><div className="acq-built">{reconstructed || "Choose characters below"}</div>
              <div className="acq-letters">{ordered.map((letterIndex) => <button key={letterIndex} type="button" disabled={selected.includes(letterIndex)}
                onClick={() => setSelected((previous) => [...previous, letterIndex])}>{letters[letterIndex]}</button>)}</div>
              <button type="button" onClick={() => setSelected([])}>Start again</button></div> : null}
            {active === "meaning" && alternatives.length ? <div className="acq-options">{alternatives.map((option) =>
              <button key={option} type="button" className={input === option ? "selected" : ""} onClick={() => { setInput(option); setError(""); }}>{option}</button>)}</div> : null}
            {["typing","missing","context","contrast","sentence","association"].includes(active) || (active === "meaning" && !alternatives.length) ? <textarea className="acq-input" rows={active === "sentence" ? 3 : 2} value={input}
              onChange={(event) => { setInput(event.target.value); setError(""); }} placeholder={active === "typing" || active === "missing" ? "Type here…" : "Write your answer…"} /> : null}
            {error ? <p className="acq-error" role="alert">{error}</p> : null}
            <div className="acq-confirm"><span>{OBJECTIVE.includes(active) && (active !== "meaning" || alternatives.length) ? "Checked automatically" : "Self-confirmed after practice"}</span>
              <button type="button" className="acq-primary" disabled={busy || (active === "reconstruct" && selected.length !== letters.length) || (active === "handwriting" && !inked)}
                onClick={() => void submit()}>{busy ? "Saving…" : "Complete · +10"} <Check size={15}/></button></div>
          </div> : null}
        </div>
        <footer className="acq-bottom">
          <button type="button" onClick={() => nextCard(-1)} disabled={busy || index === 0}><ArrowLeft size={15}/> Previous</button>
          <button type="button" onClick={() => setFinished(true)} disabled={busy}>Finish session</button>
          <button type="button" onClick={() => nextCard(1)} disabled={busy || index >= local.length - 1}>Next card <ArrowRight size={15}/></button>
        </footer>
      </>}
    </section>
  </div>, document.body);
}
