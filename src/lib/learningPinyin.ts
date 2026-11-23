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
