import { pinyin } from "pinyin-pro";
import { numberedPinyinToMarks } from "./answerCheck";
import { repairPinyinToneMarks } from "./pinyinUnicode";
import type { Exercise, LearnCard } from "./learnExercises";

const KEY = "heuresis.learn.pinyin.v1";
const HAN = /\p{Script=Han}/u;

export function readLearningPinyin() {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}
export function writeLearningPinyin(show: boolean) {
  try { localStorage.setItem(KEY, show ? "on" : "off"); } catch { /* device preference only */ }
}

export function isChineseLearningCard(card: LearnCard) {
  return card.language === "zh" || (card.language == null && card.han);
}

export function learningReading(text: string, saved?: string): string {
  if (!HAN.test(text)) return "";
  if (saved?.trim()) return numberedPinyinToMarks(repairPinyinToneMarks(saved.trim()));
  // Local dictionary, including distractors with no saved reading. Preserve blanks in cloze prompts.
  const reading = pinyin(text, { toneType: "symbol", nonZh: "consecutive" }).trim();
  return reading && reading !== text && !HAN.test(reading) ? reading : "";
}

/** Old saved rounds may already carry the reading in their subtitle. Never hide a meaning. */
export function learningSubtitle(item: Exercise, card: LearnCard, show: boolean) {
  const sub = item.prompt.sub;
  if (!isChineseLearningCard(card) || !sub) return sub;
  if (item.kind === "choose-reading") return sub;
  // Reconstructing characters must show Pinyin on the tiles, never the complete answer above them.
  // This also protects rounds already saved with the full reading in their prompt subtitle.
  if (item.format === "build" && ["build-term", "recall-build", "build-meaning"].includes(item.kind)) return undefined;
  if (item.kind === "missing-character") return show ? sub : card.meaning || undefined;
  if (item.kind === "example-meaning" || item.kind === "type-meaning" || item.kind === "build-meaning"
      || item.kind === "build-term" || item.kind === "recall-guided") return show ? sub : undefined;
  return sub;
}

/** Feedback is presentation-only; leave the stored exercise and verdict intact. */
export function withoutLearningReading(text: string, card: LearnCard) {
  if (!card.reading || !isChineseLearningCard(card)) return text;
  return text.split(` (${card.reading})`).join("").split(` · ${card.reading}`).join("");
}

/** Compare syllables without tones, keeping ü distinct from u. */
function syllableLetters(value: string) {
  return value.toLowerCase().replace(/ü/g, "v").normalize("NFD").replace(/\p{Mark}/gu, "");
}
const HAN_CHARACTER = /^\p{Script=Han}$/u;

/** Align the saved Pinyin with Hanzi even when syllables are joined, e.g. Zhège. */
function alignSavedReading(characters: string[], saved: string, inferred: string[]): string[] | null {
  const normalized = numberedPinyinToMarks(repairPinyinToneMarks(saved)).normalize("NFC").toLowerCase();
  const words = normalized.trim().split(/\s+/u).map((word) =>
    word.replace(/^[^\p{Script=Latin}]+|[^\p{Script=Latin}\p{Mark}]+$/gu, "")).filter(Boolean);
  if (words.length === characters.length && words.every((word) =>
    /^[\p{Script=Latin}\p{Mark}]+$/u.test(word))) return words;

  const letters = Array.from(normalized).filter((char) => /[\p{Script=Latin}\p{Mark}]/u.test(char));
  if (!letters.length) return null;
  const missed = new Set<string>();
  function search(at: number, cursor: number): string[] | null {
    if (at === characters.length) return cursor === letters.length ? [] : null;
    const key = `${at}:${cursor}`;
    if (missed.has(key)) return null;
    const options = [...new Set([
      inferred[at], ...pinyin(characters[at], { multiple: true, type: "array" }),
    ].filter(Boolean))];
    for (const reading of options) {
      const length = Array.from(reading).length;
      const portion = letters.slice(cursor, cursor + length).join("");
      if (syllableLetters(portion) !== syllableLetters(reading)) continue;
      const rest = search(at + 1, cursor + length);
      if (rest !== null) return [portion, ...rest];
    }
    missed.add(key);
    return null;
  }
  return search(0, 0);
}

/**
 * The answer tiles use the full Chinese expression, not isolated-character defaults.
 * A polyphonic distractor without context gets no reading, rather than a false one.
 */
export function learningBuildTileReadings(item: Extract<Exercise, { format: "build" }>, card: LearnCard): Map<string, string> {
  const result = new Map<string, string>();
  if (!isChineseLearningCard(card)) return result;
  const characters = Array.from(item.answer.join(item.joiner)).filter((ch) => HAN_CHARACTER.test(ch));
  if (!characters.length) return result;
  const sameText = (text: string) => Array.from(text).filter((ch) => HAN_CHARACTER.test(ch)).join("") === characters.join("");
  const example = card.examples.find((entry) => entry.reading && sameText(entry.source));
  const source = example?.source ?? (sameText(card.form) ? card.form : item.answer.join(item.joiner));
  const saved = example?.reading ?? (sameText(card.form) ? card.reading : "");
  const contextual = pinyin(source, { toneType: "symbol", type: "array", nonZh: "removed" });
  const inferred = contextual.length === characters.length ? contextual : characters.map((ch) => pinyin(ch));
  const readings = (saved && alignSavedReading(characters, saved, inferred)) || inferred;

  let offset = 0;
  for (const [index, piece] of item.answer.entries()) {
    const length = Array.from(piece).filter((ch) => HAN_CHARACTER.test(ch)).length;
    const reading = length && readings.slice(offset, offset + length).length === length
      ? readings.slice(offset, offset + length).join(" ") : "";
    offset += length;
    // Generator places answer pieces first (t0..tN), then scrambles the complete bank.
    const tile = item.tiles.find((entry) => entry.id === `t${index}` && entry.text === piece);
    if (tile) result.set(tile.id, reading);
  }
  for (const tile of item.tiles) {
    if (result.has(tile.id)) continue;
    const polyphonic = HAN_CHARACTER.test(tile.text) &&
      pinyin(tile.text, { multiple: true, type: "array" }).length > 1;
    result.set(tile.id, polyphonic ? "" : learningReading(tile.text));
  }
  return result;
}
