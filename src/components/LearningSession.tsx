import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Delete, Lightbulb, RotateCcw, Volume2, X } from "lucide-react";
import type { CardWithStats } from "../lib/heuresis";
import {
  buildRound, checkExercise, exerciseLabel, learnable, readPlan, toLearnCard,
  type Exercise, type ExerciseInput, type LearnCard, type Verdict,
} from "../lib/learnExercises";
import { answerMentions, appliedCoverage, roundHistory, type RoundHistory } from "../lib/appliedExercises";
import { packShape } from "../lib/teachingShape";
import {
  LEARN_SETUP_MESSAGE, READY_SCORE, ROUND_MAX, ROUND_SIZE, STAGE_LABEL, firstLearnRound, randomLearnCard, MIX_DAILY_MAX,
  cacheRound, forgetCachedRound, learnSchemaMissing, loadLearnOverview, loadLearnRound, markLearnCorrected, openLearnRound,
  pointsFor, recordLearnAttempt, roundResult, stateForCycle,
  type LearnAttempt, type LearnOverview, type LearnRound,
} from "../lib/learnRounds";
import { isLearnCard, learnQueue, learnStatus, type LearnStatus, type LearnTopic } from "../lib/learnSession";
import { useAndroidOverlayBack, useAndroidStudyWakeLock } from "../lib/androidStudySession";
import { enterReview, readAcquisition, saveAcquisition } from "../lib/learningStage";
import { canSpeak, learningFeedbackSpeech, readAutoPronunciation, speakReviewText, stopReviewAudio } from "../lib/reviewAudio";
import { isChineseLearningCard, learningReading, learningSubtitle, readLearningPinyin, withoutLearningReading, writeLearningPinyin } from "../lib/learningPinyin";
import "./learning-session.css";

type Props = {
  /** The topics in scope, each with all its cards (cards outside Learn only supply distractors). */
  topics: LearnTopic[];
  /** Subject / topic shown in the header. */
  title: string;
  onClose: () => void;
  /** Called whenever persisted Learning state changed, so counts elsewhere stay right. */
  onChanged: () => void;
};

type Entry = { card: CardWithStats; topic: LearnTopic; view: LearnCard; status: LearnStatus };
type Current = { entry: Entry; round: LearnRound; plan: Exercise[] };
type Screen = "loading" | "select" | "setup" | "failed" | "empty" | "exercise" | "summary" | "finished";
type LearnPhase = "first" | "mixed";
/** How the answer on screen is being given: scored, or as unscored practice. */
type Mode = "scored" | "again" | "practice";
type Shown = { verdict: Verdict; mode: Mode; points: number; assisted: boolean };

/**
 * A stress mark (а́) is a small combining accent that many interface fonts place badly over
 * Cyrillic. The stressed vowel is therefore also emphasised, so it cannot be misread.
 */
function stressed(text: string): ReactNode {
  if (!text.includes("\u0301")) return text;
  const parts: ReactNode[] = [];
  const chars = Array.from(text);
  let plain = "";
  chars.forEach((char, index) => {
    if (char === "\u0301") return;
    if (chars[index + 1] === "\u0301") {
      if (plain) { parts.push(plain); plain = ""; }
      parts.push(<span key={index} className="lrn-stress">{char}{"\u0301"}</span>);
    } else plain += char;
  });
  if (plain) parts.push(plain);
  return parts;
}

const IME = (event: ReactKeyboardEvent | KeyboardEvent) => ("isComposing" in event && event.isComposing) || event.keyCode === 229;
const message = (failure: unknown, fallback: string) =>
  learnSchemaMissing(failure) ? LEARN_SETUP_MESSAGE : failure instanceof Error && failure.message ? failure.message : fallback;

/**
 * Learn: one card, five exercises, one exercise on screen at a time.
 *
 *   Question → Answer → Feedback → Next exercise … → Round summary → Move to Review
 *
 * Every first answer is recorded as soon as it is given (heuresis_learn_attempts), so
 * leaving or refreshing resumes at the same exercise. Review grades, statistics and
 * scheduling are never written from here.
 */
export default function LearningSession({ topics, title, onClose, onChanged }: Props) {
  useAndroidStudyWakeLock(true);
  const releaseBackEntry = useAndroidOverlayBack("learn", () => leave());
  const [screen, setScreen] = useState<Screen>("loading");
  const [problem, setProblem] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [unlearnable, setUnlearnable] = useState(0);
  const [current, setCurrent] = useState<Current | null>(null);
  const [step, setStep] = useState(0);
  const [practice, setPractice] = useState<{ positions: number[]; at: number } | null>(null);
  const [again, setAgain] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [showPinyin, setShowPinyin] = useState(readLearningPinyin);
  const [, refreshSpeech] = useState(0);
  useEffect(() => {
    const ready = () => refreshSpeech((value) => value + 1);
    window.addEventListener("heuresis-speech-ready", ready);
    window.speechSynthesis?.addEventListener?.("voiceschanged", ready);
    return () => {
      window.removeEventListener("heuresis-speech-ready", ready);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", ready);
      stopReviewAudio();
    };
  }, []);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [tileIds, setTileIds] = useState<string[]>([]);
  const [gapFill, setGapFill] = useState<Array<{ ch: string; bank: number } | null>>([]);
  const [text, setText] = useState("");
  const [hinted, setHinted] = useState(false);
  /** A free answer (judge format): the card's points are shown and the learner ticks what the answer contains. */
  const [judging, setJudging] = useState(false);
  const [covered, setCovered] = useState<string[]>([]);
  const [gain, setGain] = useState(0);
  const [saving, setSaving] = useState<"idle" | "saving" | "failed">("idle");
  const [saveProblem, setSaveProblem] = useState("");
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<string[]>([]);
  const [finishedCards, setFinishedCards] = useState(0);
  const [startedIds, setStartedIds] = useState<string[]>([]);

  const overview = useRef<LearnOverview | null>(null);
  const lastRound = useRef(new Map<string, number>());
  const scores = useRef(new Map<string, number>());
  const dailyPoints = useRef(new Map<string, number>());
  const blockedToday = useRef(new Set<string>());
  const sessionPhase = useRef<LearnPhase | null>(null);
  /** What each card's previous round showed and where it went wrong, so the next round can build on it. */
  const histories = useRef(new Map<string, RoundHistory>());
  const outbox = useRef<Array<{ roundId: string; cardId: string; attempt: LearnAttempt; complete?: boolean }>>([]);
  const flushing = useRef(false);
  const dirty = useRef(false);
  const answering = useRef(false);
  const opening = useRef(false);
  const shell = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const changed = useRef(onChanged); changed.current = onChanged;

  const exercise = useMemo<Exercise | null>(() => {
    if (!current) return null;
    if (practice) return current.plan[practice.positions[practice.at] - 1] ?? null;
    return current.plan[Math.min(step, ROUND_SIZE - 1)] ?? null;
  }, [current, practice, step]);
  const chinese = Boolean(current && isChineseLearningCard(current.entry.view));
  // Tone recognition must never reveal the pronunciation being tested.
  const pinyinVisible = chinese && showPinyin && exercise?.kind !== "choose-reading";
  const readings = useMemo(() => {
    const result = new Map<string, string>();
    if (!current || !pinyinVisible) return result;
    const { topic, view } = current.entry;
    const cards = topic.cards.map((card) => toLearnCard(card, topic.pack, topic.language)).filter(isChineseLearningCard);
    const ambiguous = new Set<string>();
    function remember(text: string, reading: string) {
      if (!text || !reading || ambiguous.has(text)) return;
      if (result.has(text) && result.get(text) !== reading) { result.delete(text); ambiguous.add(text); }
      else result.set(text, reading);
    }
    for (const card of cards) {
      remember(card.form, card.reading);
      for (const example of card.examples) remember(example.source, example.reading);
    }
    if (view.reading) result.set(view.form, view.reading);
    for (const example of view.examples) if (example.reading) result.set(example.source, example.reading);
    return result;
  }, [current?.entry, pinyinVisible]);
  function togglePinyin() {
    const next = !showPinyin;
    setShowPinyin(next);
    writeLearningPinyin(next);
  }
  function readingFor(value: string) {
    return pinyinVisible ? learningReading(value, readings.get(value)) : "";
  }
  function withPinyin(value: string): ReactNode {
    const reading = readingFor(value);
    return reading ? <><span>{stressed(value)}</span><small className="lrn-pinyin" lang="zh-Latn">{reading}</small></> : stressed(value);
  }
  const promptSubtitle = exercise && current ? learningSubtitle(exercise, current.entry.view, pinyinVisible) : exercise?.prompt.sub;
  const subtitleHasReading = Boolean(promptSubtitle && exercise && ["example-meaning", "type-meaning", "build-meaning", "missing-character"].includes(exercise.kind));
  const promptPinyin = exercise && !subtitleHasReading ? readingFor(exercise.prompt.text) : "";
  const attempts = current?.round.attempts ?? [];
  const result = useMemo(() => roundResult(attempts, current?.round.baseScore), [attempts, current?.round.baseScore]);
  const mode: Mode = practice ? "practice" : again ? "again" : "scored";
  const firstLearning = current ? firstLearnRound(current.round) : false;
  const available = learnQueue(entries).filter(entry => !blockedToday.current.has(entry.card.id));
  const firstPool = available.filter(isIntroduction);
  const mixedPool = available.filter(entry => !isIntroduction(entry));
  const queue = sessionPhase.current === "first" ? firstPool : sessionPhase.current === "mixed" ? mixedPool : available;
  const ready = useMemo(() => entries.filter((entry) => entry.status === "ready" && !moved.includes(entry.card.id)), [entries, moved]);
  const upcoming = queue.filter(entry => entry.card.id !== current?.entry.card.id);
  function isIntroduction(entry: Entry) {
    const known = stateForCycle(overview.current?.cards.get(entry.card.id), readAcquisition(entry.card.data).cycle);
    return !known?.last && !lastRound.current.has(entry.card.id) && (!known?.active || known.active.roundNumber === 1);
  }
  function chooseNext(pool: Entry[], currentId = "") {
    const introductions = pool.filter(isIntroduction);
    return introductions[0] ?? randomLearnCard(pool, currentId);
  }
  // First acquisition stays on one card; mixed learning switches after scored answers.
  const mixedCandidates = upcoming.filter(entry => !isIntroduction(entry));
  const mixedNext = !firstLearning && mixedCandidates.length ? randomLearnCard(mixedCandidates) : undefined;
  const mixing = Boolean(mixedNext);
  const dailyDone = Boolean(current && blockedToday.current.has(current.entry.card.id));

  /* ---------------------------------------------------------------- saving */

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSaving("saving");
    try {
      while (outbox.current.length) {
        const next = outbox.current[0];
        const savedRound = await recordLearnAttempt(next.roundId, next.attempt);
        outbox.current.shift();
        // Another device may already have spent today's allowance.
        if (savedRound && !savedRound.attempts.some(a => a.position === next.attempt.position)) {
          blockedToday.current.add(next.cardId);
          scores.current.set(next.cardId, roundResult(savedRound.attempts, savedRound.baseScore).score);
          forgetCachedRound(next.cardId);
          outbox.current = outbox.current.filter(a => a.cardId !== next.cardId);
          setCurrent(null);
          setProblem("This card has reached its learning allowance for today.");
          setScreen("finished");
          dirty.current = true;
          continue;
        }
        // The device copy of a finished round is only dropped once the server has its last answer.
        if (next.complete || next.attempt.position === ROUND_SIZE) forgetCachedRound(next.cardId);
      }
      setSaving("idle"); setSaveProblem("");
      if (dirty.current) { dirty.current = false; changed.current(); }
    } catch (failure) {
      setSaving("failed");
      setSaveProblem(message(failure, "Your answers could not be saved yet."));
    } finally { flushing.current = false; }
  }, []);

  /* --------------------------------------------------------------- loading */

  const resetAnswer = useCallback((next: Exercise | null) => {
    stopReviewAudio();
    answering.current = false;
    setShown(null); setChoiceId(null); setTileIds([]); setText(""); setHinted(false); setJudging(false); setCovered([]);
    setGapFill(next?.format === "gaps" ? next.cells.filter((cell) => cell.gap).map(() => null) : []);
  }, []);

  const startCard = useCallback(async (entry: Entry) => {
    if (opening.current) return;
    opening.current = true;
    setScreen("loading"); setProblem(""); setPractice(null); setAgain(false); setGain(0);
    try {
      const { card, topic, view } = entry;
      const acquisition = readAcquisition(card.data);
      const known = stateForCycle(overview.current?.cards.get(card.id), acquisition.cycle);
      const previous = Math.max(lastRound.current.get(card.id) ?? 0, known?.last?.roundNumber ?? 0);
      const mastery = scores.current.get(card.id) ?? known?.last?.score ?? 0;
      // An Applied rule is told apart from the rules it is most often confused with, which may sit
      // in other topics of the same collection.
      const neighbours = view.rule
        ? topics.filter((other) => other.pack.collection_id === topic.pack.collection_id && packShape(other.pack) === "rule") : [topic];
      const pool = neighbours.flatMap((other) => other.cards.map((item) => toLearnCard(item, other.pack, other.language))).filter(learnable);
      // The previous round, from this session or (best effort) from the server, shapes the next one.
      let history = histories.current.get(card.id) ?? null;
      if (!history && view.rule && known?.last && !known.last.ready) {
        const stored = await loadLearnRound(known.last.id);
        if (stored) history = roundHistory(stored.plan, stored.attempts, known.last.score);
      }
      const opened = await openLearnRound({
        cardId: card.id, cycle: acquisition.cycle,
        proposal: () => ({ roundNumber: previous + 1, baseScore: mastery, plan: buildRound({ card: view, pool, round: previous + 1, seed: crypto.randomUUID(), history, mastery }) }),
      });
      // A round stored by a different version of the exercises is rebuilt for display; its answers stay valid.
      const plan = readPlan(opened.round.plan) ?? buildRound({ card: view, pool, round: opened.round.roundNumber, seed: opened.round.id, mastery: opened.round.baseScore });
      for (const attempt of opened.unsent) outbox.current.push({ roundId: opened.round.id, cardId: card.id, attempt, complete: roundResult(opened.round.attempts, opened.round.baseScore).complete });
      if (opened.unsent.length) void flush();
      const next: Current = { entry, round: opened.round, plan };
      setCurrent(next);
      scores.current.set(card.id, roundResult(opened.round.attempts, opened.round.baseScore).score);
      setEntries((all) => all.map((item) => item.card.id === card.id ? { ...item, status: "started" } : item));
      setStartedIds((ids) => (ids.includes(card.id) ? ids : [...ids, card.id]));
      const answered = opened.round.attempts.length;
      if (opened.round.status === "completed" || roundResult(opened.round.attempts, opened.round.baseScore).complete) { completeRound(next); return; }
      setStep(answered);
      resetAnswer(plan[answered]);
      setScreen("exercise");
    } catch (failure) {
      if (learnSchemaMissing(failure)) setScreen("setup");
      else { setProblem(message(failure, "This card could not be opened.")); setScreen("failed"); }
    } finally { opening.current = false; }
  // completeRound only reads refs and setters; the topics are those the session was opened with.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, resetAnswer]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = topics.flatMap((topic) => topic.cards.filter(isLearnCard).map((card) => ({ card, topic, view: toLearnCard(card, topic.pack, topic.language) })));
        const usable = all.filter((item) => learnable(item.view));
        const loaded = await loadLearnOverview(usable.map((item) => item.card.id));
        if (cancelled) return;
        if (!loaded.available) { setScreen("setup"); return; }
        overview.current = loaded;
        for (const item of usable) {
          const state = stateForCycle(loaded.cards.get(item.card.id), readAcquisition(item.card.data).cycle);
          scores.current.set(item.card.id, state?.active?.score ?? state?.last?.score ?? 0);
          dailyPoints.current.set(item.card.id, state?.dailyPoints ?? 0);
          if (state?.blockedToday) blockedToday.current.add(item.card.id);
        }
        const next = usable.map((item) => ({ ...item, status: learnStatus(item.card, loaded.cards.get(item.card.id)) }));
        setEntries(next); setUnlearnable(all.length - usable.length);
        const eligible = learnQueue(next).filter(entry => !blockedToday.current.has(entry.card.id));
        const fresh = eligible.filter(isIntroduction);
        const mixed = eligible.filter(entry => !isIntroduction(entry));
        if (fresh.length && mixed.length) { setScreen("select"); return; }
        sessionPhase.current = fresh.length ? "first" : mixed.length ? "mixed" : null;
        const first = fresh[0] ?? randomLearnCard(mixed);
        if (first) await startCard(first);
        else setScreen(next.length ? "finished" : "empty");
      } catch (failure) {
        if (cancelled) return;
        if (learnSchemaMissing(failure)) setScreen("setup");
        else { setProblem(message(failure, "Learn could not be opened.")); setScreen("failed"); }
      }
    })();
    return () => { cancelled = true; };
  // The session works on the cards it was opened with.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------------------- the round */

  function completeRound(done: Current) {
    const outcome = roundResult(done.round.attempts, done.round.baseScore);
    scores.current.set(done.entry.card.id, outcome.score);
    lastRound.current.set(done.entry.card.id, done.round.roundNumber);
    if (firstLearnRound(done.round)) blockedToday.current.add(done.entry.card.id);
    histories.current.set(done.entry.card.id, roundHistory(done.plan, done.round.attempts, outcome.score));
    setEntries((all) => all.map((entry) => entry.card.id === done.entry.card.id ? { ...entry, status: outcome.ready ? "ready" : "retry" } : entry));
    setFinishedCards((count) => count + 1);
    setPractice(null); setAgain(false); setShown(null);
    dirty.current = true;
    if (!outbox.current.length && !flushing.current) { dirty.current = false; changed.current(); }
    setScreen("summary");
  }

  function submit(given: ExerciseInput) {
    if (!current || !exercise || shown || answering.current) return;
    const verdict = checkExercise(exercise, given);
    const audio = learningFeedbackSpeech(current.entry.view, exercise);
    const playFeedback = () => { if (audio && readAutoPronunciation() && canSpeak(audio.locale)) speakReviewText(audio.text, audio.locale); };
    if (mode !== "scored") {
      // Practising the right answer after feedback helps, and never changes the score.
      if (verdict.correct) void markLearnCorrected(current.round.id, exercise.position).catch(() => undefined);
      setShown({ verdict, mode, points: 0, assisted: false });
      playFeedback();
      return;
    }
    if (current.round.attempts.some((attempt) => attempt.position === exercise.position)) return;
    answering.current = true; // A second click or key press cannot answer the same exercise again.
    const attempt: LearnAttempt = {
      position: exercise.position, stage: exercise.stage, exerciseType: exercise.kind,
      correct: verdict.correct, assisted: hinted, points: pointsFor(verdict.correct, hinted),
      response: verdict.response, expected: verdict.expected, createdAt: new Date().toISOString(),
    };
    const round: LearnRound = { ...current.round, attempts: [...current.round.attempts, attempt] };
    cacheRound(round);
    setCurrent({ ...current, round });
    setShown({ verdict, mode, points: attempt.points, assisted: hinted });
    playFeedback();
    setGain(attempt.points);
    const outcome = roundResult(round.attempts, round.baseScore);
    scores.current.set(round.cardId, outcome.score);
    if (!firstLearnRound(round) && attempt.points > 0) {
      const earned = (dailyPoints.current.get(round.cardId) ?? 0) + attempt.points;
      dailyPoints.current.set(round.cardId, earned);
      if (earned >= MIX_DAILY_MAX) blockedToday.current.add(round.cardId);
    }
    outbox.current.push({ roundId: round.id, cardId: round.cardId, attempt, complete: outcome.complete });
    void flush();
  }

  function proceed() {
    if (!current || !shown) return;
    stopReviewAudio();
    if (practice) {
      if (practice.at + 1 < practice.positions.length) {
        const next = { ...practice, at: practice.at + 1 };
        setPractice(next); resetAnswer(current.plan[next.positions[next.at] - 1]);
      } else { setPractice(null); setShown(null); setScreen("summary"); }
      return;
    }
    setAgain(false); setGain(0);
    if (result.complete || mixing || dailyDone) {
      if (outbox.current.length || flushing.current) { void flush(); return; }
      if (result.complete) {
        completeRound(current);
        if (!firstLearning && !result.ready) {
          const next = mixedNext ?? chooseNext(upcoming) ?? (!dailyDone ? current.entry : undefined);
          if (next) void startCard(next);
          else { setCurrent(null); setScreen("finished"); }
        }
        return;
      }
      if (mixedNext) { void startCard(mixedNext); return; }
      if (dailyDone) {
        const next = chooseNext(upcoming);
        if (next) void startCard(next);
        else { setCurrent(null); setScreen("finished"); }
        return;
      }
    }
    const next = current.round.attempts.length;
    setStep(next); resetAnswer(current.plan[next]);
  }

  function tryAgain() {
    if (!exercise) return;
    setAgain(true); resetAnswer(exercise);
  }

  function practiseMistakes() {
    if (!current) return;
    const positions = current.round.attempts.filter((attempt) => !attempt.correct).map((attempt) => attempt.position);
    if (!positions.length) return;
    setPractice({ positions, at: 0 }); setAgain(false);
    resetAnswer(current.plan[positions[0] - 1]);
    setScreen("exercise");
  }

  async function moveToReview(targets: Entry[]) {
    if (moving || !targets.length || outbox.current.length) return;
    setMoving(true); setProblem("");
    try {
      // One card at a time: a failure never leaves a false claim that every card moved.
      for (const entry of targets) {
        const saved = await saveAcquisition(entry.card, enterReview(readAcquisition(entry.card.data), "ready"));
        forgetCachedRound(saved.id);
        setMoved((ids) => [...ids, saved.id]);
      }
      changed.current();
    } catch (failure) {
      setProblem(message(failure, "The card could not be moved to Review."));
    } finally { setMoving(false); }
  }

  function startPhase(phase: LearnPhase) {
    sessionPhase.current = phase;
    const next = phase === "first" ? firstPool[0] : randomLearnCard(mixedPool);
    if (next) void startCard(next);
  }

  function nextCard() {
    const next = chooseNext(upcoming);
    if (next) void startCard(next);
    else { setCurrent(null); setScreen("finished"); }
  }

  function leave() {
    if (outbox.current.length) void flush();
    releaseBackEntry();
    onClose();
  }

  /* ------------------------------------------------------------ interaction */

  const gapCount = exercise?.format === "gaps" ? exercise.cells.filter((cell) => cell.gap).length : 0;
  const canCheck = Boolean(exercise) && !shown && (
    exercise!.format === "build" ? tileIds.length > 0
      : exercise!.format === "gaps" ? gapFill.length === gapCount && gapFill.every(Boolean)
        : exercise!.format === "type" ? Boolean(text.trim())
          : exercise!.format === "judge" ? judging || Boolean(text.trim()) : false);

  function check(skip = false) {
    if (!exercise || shown) return;
    if (exercise.format === "build") submit({ format: "build", tileIds: skip ? [] : tileIds });
    else if (exercise.format === "gaps") submit({ format: "gaps", letters: skip ? [] : gapFill.map((cell) => cell?.ch ?? "") });
    else if (exercise.format === "type") submit({ format: "type", text: skip ? "" : text });
    else if (exercise.format === "judge") {
      // First the answer is written; then the card's points are shown to tick; then it counts.
      if (skip) submit({ format: "judge", text: "", covered: [] });
      else if (!judging) setJudging(true);
      else submit({ format: "judge", text, covered });
    }
  }

  function toggleCovered(id: string) {
    if (shown) return;
    setCovered((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
  }

  function choose(id: string) {
    if (shown || exercise?.format !== "choice") return;
    setChoiceId(id);
    submit({ format: "choice", choiceId: id });
  }

  function fillGap(ch: string, bank: number) {
    setGapFill((cells) => {
      const at = cells.findIndex((cell) => !cell);
      if (at < 0) return cells;
      const next = [...cells]; next[at] = { ch, bank };
      return next;
    });
  }

  function typeIntoGap(ch: string) {
    if (exercise?.format !== "gaps") return;
    const used = new Set(gapFill.filter(Boolean).map((cell) => cell!.bank));
    const bank = exercise.bank.findIndex((letter, index) => !used.has(index) && letter.toLocaleLowerCase() === ch.toLocaleLowerCase());
    fillGap(bank >= 0 ? exercise.bank[bank] : ch, bank);
  }

  function clearLastGap() {
    setGapFill((cells) => {
      let at = -1;
      cells.forEach((cell, index) => { if (cell) at = index; });
      if (at < 0) return cells;
      const next = [...cells]; next[at] = null;
      return next;
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (IME(event)) return;
    if (event.key === "Escape") { event.preventDefault(); leave(); return; }
    if (screen !== "exercise" || !exercise) return;
    if (event.target instanceof HTMLElement && event.target.closest("[data-pronunciation], [data-pinyin-toggle]") && (event.key === "Enter" || event.key === " ")) return;
    const typing = event.target instanceof HTMLInputElement;
    if (shown) {
      // Enter moves on; Space too, except on a focused button, where it already activates it.
      if (event.key === "Enter" || (event.key === " " && !(event.target instanceof HTMLButtonElement))) { event.preventDefault(); proceed(); }
      return;
    }
    // A free answer may run over several lines: Enter makes a new line, Ctrl/⌘ + Enter checks.
    if (event.target instanceof HTMLTextAreaElement) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (canCheck) check(); }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (exercise.format === "judge" && judging) {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < exercise.points.length) { event.preventDefault(); toggleCovered(exercise.points[index].id); return; }
    }
    if (exercise.format === "choice") {
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < exercise.choices.length) { event.preventDefault(); choose(exercise.choices[index].id); }
      return;
    }
    if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { if (canCheck) { event.preventDefault(); check(); } return; }
    if (typing) return;
    if (exercise.format === "build") {
      if (event.key === "Backspace") { event.preventDefault(); setTileIds((ids) => ids.slice(0, -1)); return; }
      const index = Number(event.key) - 1;
      const free = exercise.tiles.filter((tile) => !tileIds.includes(tile.id));
      if (Number.isInteger(index) && index >= 0 && index < free.length) { event.preventDefault(); setTileIds((ids) => [...ids, free[index].id]); }
      return;
    }
    if (exercise.format === "gaps") {
      if (event.key === "Backspace") { event.preventDefault(); clearLastGap(); return; }
      if (Array.from(event.key).length === 1 && /[\p{L}\p{M}]/u.test(event.key)) { event.preventDefault(); typeIntoGap(event.key); }
    }
  }

  // Keep the keyboard where the next action is: the text field, the Continue button, or the screen itself.
  // A button that is still disabled (while an answer is being saved) cannot take focus, so this
  // runs again when saving or moving ends; until then the screen itself holds the keyboard.
  useEffect(() => {
    const target = screen === "exercise" && !shown && exercise?.format === "type" ? input.current
      : screen === "exercise" && !shown && exercise?.format === "judge" && !judging ? area.current
        : (screen === "exercise" && shown) || screen === "summary" || screen === "finished" ? primary.current : null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else if (!shell.current?.contains(document.activeElement)) shell.current?.focus({ preventScroll: true });
  }, [screen, exercise, shown, again, saving, moving, moved.length, judging]);

  // The app behind is out of reach while Learn is open, and does not scroll under a finger.
  useEffect(() => {
    const root = document.getElementById("root");
    const page = document.documentElement;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = page.style.overflow;
    root?.setAttribute("inert", "");
    page.style.overflow = "hidden";
    return () => { root?.removeAttribute("inert"); page.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);

  /* ----------------------------------------------------------------- render */

  const startedCount = startedIds.length;
  // Cards already worked on in this session, plus those still waiting.
  const cardTotal = Math.max(startedCount + upcoming.filter((entry) => !startedIds.includes(entry.card.id)).length, 1);
  const stepLabel = practice ? `Practice ${practice.at + 1} of ${practice.positions.length}` : `Exercise ${Math.min(step + 1, ROUND_SIZE)}/${ROUND_SIZE}`;
  const notSaved = saving === "failed";

  function segments() {
    return <div className="lrn-progress" role="progressbar" aria-label="Progress through the five exercises"
      aria-valuemin={0} aria-valuemax={ROUND_SIZE} aria-valuenow={attempts.length}>
      {Array.from({ length: ROUND_SIZE }, (_, index) => {
        const attempt = attempts.find((item) => item.position === index + 1);
        const state = attempt ? (attempt.points > 0 ? "right" : "wrong") : index === step && screen === "exercise" && !practice ? "now" : "todo";
        const planned = current?.plan[index];
        return <i key={index} data-state={state} title={planned ? exerciseLabel(planned) : STAGE_LABEL.recognition} />;
      })}
    </div>;
  }

  function renderAnswer(item: Exercise) {
    const locked = Boolean(shown);
    if (item.format === "choice") {
      return <div className={`lrn-choices is-${item.layout}`} role="group" aria-label="Answers">
        {item.choices.map((choice, index) => {
          const state = !locked ? "" : choice.id === item.answerId ? " is-right" : choice.id === choiceId ? " is-wrong" : " is-dim";
          return <button type="button" key={choice.id} className={`lrn-choice${state}`} lang={choice.lang} disabled={locked}
            aria-pressed={choice.id === choiceId} onClick={() => choose(choice.id)}>
            <kbd aria-hidden="true">{index + 1}</kbd><span>{withPinyin(choice.label)}</span>
            {locked && choice.id === item.answerId ? <Check size={18} aria-label="Correct answer" /> : null}
            {locked && choice.id === choiceId && choice.id !== item.answerId ? <X size={18} aria-label="Your answer" /> : null}
          </button>;
        })}
      </div>;
    }
    if (item.format === "build") {
      const picked = tileIds.map((id) => item.tiles.find((tile) => tile.id === id)!).filter(Boolean);
      return <div className={`lrn-build${item.stacked ? " is-stacked" : ""}`}>
        <div className={`lrn-built${picked.length ? "" : " is-empty"}${item.joiner ? " is-words" : ""}`} lang={item.lang} aria-label="Your answer" aria-live="polite">
          {picked.length ? picked.map((tile) => <button type="button" key={tile.id} className="lrn-tile is-picked" disabled={locked}
            aria-label={`Remove ${tile.text}`} onClick={() => setTileIds((ids) => ids.filter((id) => id !== tile.id))}>{withPinyin(tile.text)}</button>)
            : <span>{item.stacked ? "Tap the steps in order" : "Tap the pieces in order"}</span>}
        </div>
        <div className="lrn-tiles" lang={item.lang} role="group" aria-label={item.stacked ? "Steps" : "Pieces"}>
          {item.tiles.map((tile) => <button type="button" key={tile.id} className="lrn-tile" disabled={locked || tileIds.includes(tile.id)}
            onClick={() => setTileIds((ids) => [...ids, tile.id])}>{withPinyin(tile.text)}</button>)}
        </div>
      </div>;
    }
    if (item.format === "gaps") {
      let gap = -1;
      const usedBank = new Set(gapFill.filter(Boolean).map((cell) => cell!.bank));
      const nextGap = gapFill.findIndex((cell) => !cell);
      return <div className="lrn-gaps">
        <div className="lrn-word" lang={item.lang} aria-label="Word with missing letters">
          {item.cells.map((cell, index) => {
            if (!cell.gap) return cell.ch === " " ? <span key={index} className="lrn-space" /> : <span key={index} className="lrn-letter">{cell.ch}</span>;
            gap += 1; const at = gap; const filled = gapFill[at];
            return <button type="button" key={index} disabled={locked || !filled}
              className={`lrn-letter is-gap${filled ? " is-filled" : ""}${at === nextGap && !locked ? " is-next" : ""}`}
              aria-label={filled ? `Clear letter ${filled.ch}` : "Missing letter"}
              onClick={() => setGapFill((cells) => cells.map((value, position) => (position === at ? null : value)))}>{filled?.ch ?? ""}</button>;
          })}
        </div>
        <div className="lrn-tiles" lang={item.lang} role="group" aria-label="Letters">
          {item.bank.map((letter, index) => <button type="button" key={index} className="lrn-tile is-letter" disabled={locked || usedBank.has(index) || nextGap < 0}
            onClick={() => fillGap(letter, index)}>{letter}</button>)}
          <button type="button" className="lrn-tile is-tool" disabled={locked || !gapFill.some(Boolean)} aria-label="Delete the last letter" onClick={clearLastGap}><Delete size={17} /></button>
        </div>
      </div>;
    }
    if (item.format === "judge") {
      const open = judging || locked;
      return <div className="lrn-judge">
        <textarea ref={area} className="lrn-input lrn-area" value={text} rows={4} disabled={open}
          placeholder={item.placeholder} aria-label="Your answer" spellCheck autoCapitalize="sentences"
          onChange={(event) => setText(event.target.value)} />
        {open ? <fieldset className="lrn-check-points">
          <legend>{locked ? "The card’s points" : "Tick what your answer contains"}
            {item.points.some((point) => point.essential === false) ? <small>Details: half of them are enough.</small> : null}</legend>
          {item.points.map((point, index) => {
            const on = covered.includes(point.id);
            const detail = point.essential === false;
            // Advisory: a ticked point that the written answer does not seem to mention.
            const unsupported = on && !locked && !answerMentions(text, point.text);
            return <label key={point.id} className={`lrn-point${on ? " is-on" : ""}${detail ? " is-detail" : ""}${locked && !on ? (detail ? " is-skipped" : " is-missing") : ""}`}>
              <input type="checkbox" checked={on} disabled={locked} onChange={() => toggleCovered(point.id)} />
              <span className="lrn-point-box" aria-hidden="true">{on ? <Check size={14} /> : <kbd>{index + 1}</kbd>}</span>
              <span className="lrn-point-text"><b>{point.label}{detail ? <em> · detail</em> : null}</b>{point.text}
                {unsupported ? <small className="lrn-point-warn">Not found in your answer. Tick it only if you said it in other words.</small> : null}</span>
            </label>;
          })}
        </fieldset> : null}
      </div>;
    }
    return <div className="lrn-type">
      <input ref={input} className="lrn-input" type="text" value={text} lang={item.lang} disabled={locked}
        placeholder={item.placeholder} aria-label="Your answer" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        enterKeyHint="done" onChange={(event) => setText(event.target.value)} />
      {item.hint && mode === "scored" && !locked ? (hinted
        ? <p className="lrn-hint" lang={item.lang}><Lightbulb size={14} aria-hidden="true" /> {item.hint}</p>
        : <button type="button" className="lrn-link" onClick={() => setHinted(true)}><Lightbulb size={14} aria-hidden="true" /> Show first letters (no points)</button>) : null}
    </div>;
  }

  function renderFeedback(item: Exercise, state: Shown) {
    const { verdict } = state;
    const heading = verdict.correct
      ? state.mode !== "scored" ? "Correct" : state.assisted ? "Correct, with a hint" : "Correct"
      : "Not quite";
    const note = verdict.correct
      ? state.mode !== "scored" ? "Practice does not change your score." : state.assisted ? "A hinted answer earns no points." : ""
      : verdict.message;
    const canRetry = !verdict.correct && item.format !== "choice";
    const audio = current ? learningFeedbackSpeech(current.entry.view, item) : null;
    const feedbackText = (value: string) => current && !showPinyin && item.kind !== "choose-reading" ? withoutLearningReading(value, current.entry.view) : value;
    return <div className={`lrn-feedback ${verdict.correct ? "is-right" : "is-wrong"}`} role="status" aria-live="polite">
      <div className="lrn-feedback-text">
        <strong>{verdict.correct ? <Check size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}{heading}
          {state.points ? <em>{state.points > 0 ? "+" : ""}{state.points}</em> : null}</strong>
        {!verdict.correct ? <p className="lrn-solution" lang={"lang" in item ? item.lang : undefined}>{stressed(feedbackText(item.solution))}</p> : null}
        {note ? <p>{stressed(feedbackText(note))}</p> : null}
      </div>
      <div className="lrn-feedback-actions">
        {audio && canSpeak(audio.locale) ? <button type="button" data-pronunciation className="lrn-quiet lrn-pronunciation" aria-label="Hear pronunciation" title="Hear pronunciation" onClick={() => speakReviewText(audio.text, audio.locale)}><Volume2 size={17} aria-hidden="true" /></button> : null}
        {canRetry ? <button type="button" className="lrn-quiet" onClick={tryAgain}><RotateCcw size={15} aria-hidden="true" /> Try again</button> : null}
        <button type="button" ref={primary} className="lrn-primary" disabled={!practice && (result.complete || mixing || dailyDone) && (saving === "saving" || notSaved)} onClick={proceed}>
          {practice ? (practice.at + 1 < practice.positions.length ? "Next" : "Back to summary")
            : result.ready || (result.complete && firstLearning) ? "See result" : mixing || dailyDone || result.complete ? "Next card" : "Continue"}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </div>;
  }

  function renderSummary(done: Current) {
    const mistakes = done.round.attempts.filter((attempt) => !attempt.correct || attempt.assisted);
    const wasMoved = moved.includes(done.entry.card.id);
    const needs: string[] = [];
    if (!result.ready) needs.push(blockedToday.current.has(done.entry.card.id) ? "Done for today. Continue tomorrow." : `${READY_SCORE - result.score} points to Review.`);

    const waiting = saving === "saving" || outbox.current.length > 0;
    return <div className="lrn-summary">
      <p className="lrn-ask">{result.ready ? "Learning complete" : firstLearnRound(done.round) ? "First learning complete" : "Learning round complete"}</p>
      {result.ready ? <CheckCircle2 className="lrn-success-icon" size={40} aria-hidden="true" /> : null}
      <h2 className="lrn-score-line"><b>{result.score}</b><span>/ {ROUND_MAX}</span></h2>
      <p className="lrn-card-line" lang={done.entry.view.han ? "zh-Hans" : undefined}><strong>{done.entry.view.form}</strong> {done.entry.view.meaning}</p>
      <dl className="lrn-facts">
        <div><dt>Successful exercises</dt><dd>{result.correctCount}/{result.answered}</dd></div>
        <div><dt>Learning status</dt><dd className={result.ready ? "is-ready" : "is-open"}>
          {wasMoved ? <><CheckCircle2 size={16} aria-hidden="true" /> Moved to Review</>
            : result.ready ? <><CheckCircle2 size={16} aria-hidden="true" /> Ready for Review</> : "Keep learning"}</dd></div>
      </dl>
      {!result.ready ? <ul className="lrn-needs" aria-label="What to improve">{needs.map((line) => <li key={line}>{line}</li>)}</ul> : null}
      {done.entry.view.rule ? (() => {
        // An Applied card with too little material gets weaker exercises; say what would help.
        const hint = appliedCoverage(done.entry.view, done.entry.topic.cards.length - 1).hint;
        return hint ? <p className="lrn-note lrn-card-hint">{hint}</p> : null;
      })() : null}
      {mistakes.length ? <ul className="lrn-mistakes" aria-label="Mistakes in this round">
        {mistakes.map((attempt) => <li key={attempt.position}>
          <span>{exerciseLabel({ kind: attempt.exerciseType as Exercise["kind"], stage: attempt.stage })}</span>
          <p>{attempt.correct ? "Answered with a hint" : attempt.response ? <>You answered <q>{attempt.response}</q></> : "No answer"}
            {" · "}<b>{stressed(attempt.expected)}</b></p>
        </li>)}
      </ul> : <p className="lrn-clean">No mistakes in this round.</p>}
      {notSaved ? <p className="lrn-alert" role="alert">{saveProblem} <button type="button" className="lrn-link" onClick={() => void flush()}>Save again</button></p> : null}
      {problem ? <p className="lrn-alert" role="alert">{problem}</p> : null}
      <div className="lrn-actions">
        {result.ready && !wasMoved
          ? <button type="button" ref={primary} className="lrn-primary is-ready" disabled={moving || waiting || notSaved} onClick={() => void moveToReview([done.entry])}>
            {moving ? "Moving…" : waiting ? "Saving…" : "Move to Review"} <ArrowRight size={17} aria-hidden="true" /></button>
          : result.ready
            ? <button type="button" ref={primary} className="lrn-primary" onClick={upcoming.length ? nextCard : leave}>{upcoming.length ? "Continue learning another card" : "Return to Learn"} <ArrowRight size={17} aria-hidden="true" /></button>
            : <button type="button" ref={primary} className="lrn-primary" disabled={waiting || notSaved} onClick={() => blockedToday.current.has(done.entry.card.id) ? nextCard() : void startCard(mixedNext ?? done.entry)}>{waiting ? "Saving…" : blockedToday.current.has(done.entry.card.id) ? (upcoming.length ? "Continue learning another card" : "Finish for today") : mixing ? "Continue learning another card" : "Start another round"} <ArrowRight size={17} aria-hidden="true" /></button>}
        {upcoming.length && (result.ready || !mixing) && !(result.ready && wasMoved) && !(firstLearning && !result.ready) ? <button type="button" className="lrn-quiet" onClick={nextCard}>Continue learning another card</button> : null}
        {mistakes.some((attempt) => !attempt.correct) ? <button type="button" className="lrn-quiet" onClick={practiseMistakes}>Review mistakes</button> : null}
        {!(result.ready && wasMoved && !upcoming.length) ? <button type="button" className="lrn-quiet" onClick={leave}>Return to Learn</button> : null}
      </div>
    </div>;
  }

  function renderFinished() {
    const still = entries.filter((entry) => entry.status !== "ready").length;
    const doneToday = entries.filter(entry => entry.status !== "ready" && blockedToday.current.has(entry.card.id)).length;
    return <div className="lrn-summary">
      <p className="lrn-ask">{finishedCards ? "Learning complete" : "Learn"}</p>
      <h2 className="lrn-title">{ready.length
        ? `${ready.length} ${ready.length === 1 ? "card is" : "cards are"} ready for Review`
        : doneToday ? "Done for today" : moved.length ? "Everything ready has moved to Review" : "Nothing left to learn here"}</h2>
      {ready.length ? <ul className="lrn-ready-list">{ready.slice(0, 8).map((entry) => <li key={entry.card.id} lang={entry.view.han ? "zh-Hans" : undefined}>
        <CheckCircle2 size={15} aria-hidden="true" /><strong>{entry.view.form}</strong><span>{entry.view.meaning}</span></li>)}
        {ready.length > 8 ? <li className="is-more">and {ready.length - 8} more</li> : null}</ul> : null}
      <p className="lrn-note">{[
        moved.length ? `${moved.length} moved to Review in this session.` : "",
        doneToday ? `${doneToday} ${doneToday === 1 ? "card is" : "cards are"} ready to practise tomorrow.` : "",
        still ? `${still} still in Learn.` : "",
        "Moving a card only makes it available in Review; it does not count as a review.",
      ].filter(Boolean).join(" ")}</p>
      {problem ? <p className="lrn-alert" role="alert">{problem}</p> : null}
      <div className="lrn-actions">
        {ready.length ? <button type="button" ref={primary} className="lrn-primary is-ready" disabled={moving} onClick={() => void moveToReview(ready)}>
          {moving ? "Moving…" : `Move ${ready.length === 1 ? "it" : `all ${ready.length}`} to Review`} <ArrowRight size={17} aria-hidden="true" /></button> : null}
        {firstPool.length && sessionPhase.current !== "first" ? <button type="button" className="lrn-quiet" onClick={() => startPhase("first")}>First learning · {firstPool.length}</button> : null}
        {mixedPool.length && sessionPhase.current !== "mixed" ? <button type="button" className="lrn-quiet" onClick={() => startPhase("mixed")}>Mixed learning · {mixedPool.length}</button> : null}
        <button type="button" ref={ready.length ? undefined : primary} className={ready.length ? "lrn-quiet" : "lrn-primary"} onClick={leave}>Return to Learn</button>
      </div>
    </div>;
  }

  const inRound = Boolean(current) && (screen === "exercise" || screen === "summary");

  return createPortal(<div ref={shell} className="lrn" role="dialog" aria-modal="true" aria-label="Learn" tabIndex={-1} onKeyDown={onKeyDown}>
    <header className="lrn-top">
      <button type="button" className="lrn-exit" onClick={leave} aria-label="Exit Learn" title="Exit (Esc). Your progress is saved."><ArrowLeft size={19} /></button>
      <div className="lrn-context"><strong>{title}</strong>
        {inRound ? <span>Card {Math.min(startedCount, cardTotal)} of {cardTotal}</span> : null}</div>
      {inRound ? <div className={`lrn-status${gain ? " has-gain" : ""}`} aria-live="polite">
        {screen === "exercise" ? <span className="lrn-step">{firstLearning || practice ? stepLabel : "Daily practice"}{exercise && !practice ? <i> · {exerciseLabel(exercise)}</i> : null}</span> : null}
        {chinese && screen === "exercise" && exercise?.kind !== "choose-reading" ? <button type="button" className="lrn-pinyin-toggle" data-pinyin-toggle aria-pressed={showPinyin} aria-label="Show pinyin" title={showPinyin ? "Hide pinyin" : "Show pinyin"} onClick={togglePinyin}>Pinyin <span aria-hidden="true">{showPinyin ? "On" : "Off"}</span></button> : null}
        <span className="lrn-phase">{firstLearning ? "First learning" : "Mixed learning"}</span>
        <span className="lrn-points">{gain && shown ? <b key={attempts.length}>{gain > 0 ? "+" : ""}{gain} · </b> : null}{result.score}/{ROUND_MAX} <small>points</small></span>
      </div> : null}
      {inRound && firstLearning ? segments() : null}
    </header>

    {screen === "select" ? <main className="lrn-stage is-summary">
      <div className="lrn-summary">
        <p className="lrn-ask">Learn</p><h2 className="lrn-title">Choose your learning session</h2>
        <div className="lrn-mode-list">
          <button type="button" onClick={() => startPhase("first")}><span><strong>First learning</strong><small>Five exercises per new card · up to 50 points</small></span><b>{firstPool.length}</b><ArrowRight size={17} aria-hidden="true" /></button>
          <button type="button" onClick={() => startPhase("mixed")}><span><strong>Mixed learning</strong><small>Random recall · up to 20 points per card today</small></span><b>{mixedPool.length}</b><ArrowRight size={17} aria-hidden="true" /></button>
        </div>
        <p className="lrn-note">{entries.filter(e => e.status !== "ready" && blockedToday.current.has(e.card.id)).length} done for today · {ready.length} ready for Review</p>
      </div>
    </main> : null}
    {screen === "loading" ? <div className="lrn-state" role="status">Preparing your exercises…</div> : null}
    {screen === "setup" ? <div className="lrn-state"><h2 className="lrn-title">Learn is almost ready</h2><p>{LEARN_SETUP_MESSAGE}</p>
      <button type="button" className="lrn-primary" onClick={leave}>Return to Learn</button></div> : null}
    {screen === "failed" ? <div className="lrn-state" role="alert"><h2 className="lrn-title">Learn could not continue</h2><p>{problem}</p>
      <div className="lrn-actions">{current || queue[0] ? <button type="button" className="lrn-primary" onClick={() => void startCard(current?.entry ?? queue[0])}>Try again</button> : null}
        <button type="button" className="lrn-quiet" onClick={leave}>Return to Learn</button></div></div> : null}
    {screen === "empty" ? <div className="lrn-state"><h2 className="lrn-title">No cards in Learn</h2>
      <p>{unlearnable ? `${unlearnable} ${unlearnable === 1 ? "card needs" : "cards need"} a term and a meaning before exercises can be made. ` : ""}Send cards here from New, or use Relearn in Review.</p>
      <button type="button" className="lrn-primary" onClick={leave}>Return to Learn</button></div> : null}

    {screen === "exercise" && exercise ? <>
      <main className="lrn-stage" key={`${current?.round.id}:${exercise.position}:${mode}:${practice?.at ?? ""}`} data-format={exercise.format}
        data-result={shown ? (shown.verdict.correct ? "right" : "wrong") : undefined}>
        {mode !== "scored" ? <p className="lrn-practice">Practice · no points</p> : null}
        <p className="lrn-ask">{exercise.prompt.ask}</p>
        <h2 className={`lrn-prompt${Array.from(exercise.prompt.text).length > 46 ? " is-long" : ""}${exercise.prompt.style === "case" ? " is-case" : ""}`} lang={exercise.prompt.lang}>{exercise.prompt.text}</h2>
        {promptPinyin ? <p className="lrn-pinyin lrn-prompt-pinyin" lang="zh-Latn">{promptPinyin}</p> : null}
        {promptSubtitle ? <p className="lrn-sub">{promptSubtitle}</p> : null}
        {current?.entry.view.englishReference ? <p className="lrn-english-reference" lang="en">{current.entry.view.englishReference}</p> : null}
        {!shown && current && ["choose-meaning", "example-meaning", "build-meaning", "type-meaning"].includes(exercise.kind) && (() => {
          const audio = learningFeedbackSpeech(current.entry.view, exercise);
          return audio && canSpeak(audio.locale) ? <button type="button" data-pronunciation className="lrn-quiet lrn-pronunciation" aria-label="Hear prompt" title="Hear prompt" onClick={() => speakReviewText(audio.text, audio.locale)}><Volume2 size={17} aria-hidden="true" /></button> : null;
        })()}
        {renderAnswer(exercise)}
      </main>
      <footer className="lrn-bottom">
        {notSaved ? <p className="lrn-alert" role="alert">{saveProblem} <button type="button" className="lrn-link" onClick={() => void flush()}>Save again</button></p> : null}
        {shown ? renderFeedback(exercise, shown)
          : exercise.format === "choice" ? <p className="lrn-keys">Choose an answer{exercise.choices.length <= 9 ? <span>, or press 1–{exercise.choices.length}</span> : null}</p>
            : exercise.format === "judge" && judging
              ? <div className="lrn-check is-judging">
                <p className="lrn-keys">Be strict: tick only what you actually wrote.</p>
                <button type="button" className="lrn-primary" onClick={() => check()}>Confirm</button>
              </div>
              : <div className="lrn-check">
                <button type="button" className="lrn-quiet" onClick={() => check(true)}>I don’t know</button>
                <button type="button" className="lrn-primary" disabled={!canCheck} onClick={() => check()}>{exercise.format === "judge" ? "Compare" : "Check"}</button>
              </div>}
      </footer>
    </> : null}

    {screen === "summary" && current ? <main className={`lrn-stage is-summary${result.ready ? " lrn-success-stage" : ""}`}>{renderSummary(current)}</main> : null}
    {screen === "finished" ? <main className="lrn-stage is-summary">{renderFinished()}</main> : null}
  </div>, document.body);
}
