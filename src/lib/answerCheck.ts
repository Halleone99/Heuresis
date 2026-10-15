import type { StudyGrade } from "./study";

/**
 * Suggests a result for a typed answer. It is only a suggestion: the person still
 * chooses the result. Secure is never suggested, because ease is the learner's call.
 *
 *   - exact match with an accepted answer → Recalled. Alternatives are split on
 *     ; ； | / and numbered senses in every field; glosses (meanings) are also split
 *     on commas when they read as a list of short glosses, never when they are a
 *     sentence. Terms are never split on commas ("Ja, ich weiß.", "der Hund, -e").
 *   - numbered pinyin (ni3 hao3) is read as tone marks; Russian stress marks and ё/е
 *     are not spelling; spacing in pinyin and Chinese does not matter
 *   - only tones, accents or umlauts differ, or a German article is missing → Partial
 *   - one or two letters off (by length) → Partial
 *   - otherwise → Missed
 */
export type AnswerSuggestion = { grade: Extract<StudyGrade, "again" | "hard" | "good">; reason: string; matched: string | null };

const TONE_MARKS: Record<string, string> = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };

/** "ni3 hao3" / "lv4" → "nǐ hǎo" / "lǜ". Text without tone numbers is returned unchanged. */
export function numberedPinyinToMarks(value: string) {
  return value.replace(/([a-zA-ZüÜvV:]+?)([1-5])(?![0-9])/g, (match, syllable: string, digit: string) => {
    if (!/[aeiouüv]/i.test(syllable)) return match;
    const text = syllable.replace(/u:|v/g, "ü").replace(/U:|V/g, "Ü");
    const tone = Number(digit);
    if (tone === 5) return text;
    const lower = text.toLowerCase();
    let index = lower.search(/[ae]/);
    if (index < 0) index = lower.indexOf("ou");
    if (index < 0) {
      for (let at = lower.length - 1; at >= 0; at -= 1) if ("aeiouü".includes(lower[at])) { index = at; break; }
    }
    if (index < 0) return text;
    const char = text[index];
    const mark = TONE_MARKS[char.toLowerCase()]?.[tone - 1];
    if (!mark) return text;
    return text.slice(0, index) + (char === char.toLowerCase() ? mark : mark.toUpperCase()) + text.slice(index + 1);
  });
}

function hasHan(value: string) { return /\p{Script=Han}/u.test(value); }
function hasCyrillic(value: string) { return /\p{Script=Cyrillic}/u.test(value); }

/** Comparable form: case, width, punctuation and Russian stress marks removed. */
export function normaliseAnswer(value: string) {
  let text = numberedPinyinToMarks(value.normalize("NFKC")).toLocaleLowerCase();
  if (hasCyrillic(text)) text = text.normalize("NFD").replace(/́/g, "").normalize("NFC").replace(/ё/g, "е");
  text = text.replace(/\([^)]*\)|（[^）]*）/g, " ");
  text = text.replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
  return text;
}

/** English glosses: "to look forward to" and "look forward to" are the same answer. */
function withoutGlossArticle(value: string) {
  return value.replace(/^(to|the|a|an) /, "");
}

const GERMAN_ARTICLE = /^(der|die|das) (.+)$/;
const BARE_WORDS = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines", "the", "a", "an", "to", "or", "oder", "или"]);

/** Remove tone marks, accents and umlauts (ß → ss) to see whether only those differ. */
function withoutMarks(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/ß/g, "ss").normalize("NFC");
}

function compact(value: string) { return value.replace(/\s+/g, ""); }

function distance(a: string, b: string) {
  const left = Array.from(a); const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
}

/** How a field is compared: glosses (meanings) may list alternatives separated by commas. */
export type AnswerKind = "gloss" | "exact";
export type ExpectedAnswer = string | { value: string; kind: AnswerKind };

const SENTENCE_END = /[.!?。！？…]["'”’»)]*\s*$/u;

function letters(value: string) { return (value.match(/\p{L}/gu) ?? []).length; }

function words(value: string) { return value.trim().split(/\s+/).filter(Boolean).length; }

/**
 * A word or short phrase rather than a sentence: its gloss may be a list of
 * alternatives ("immediately, at once"); a sentence's translation is not.
 */
export function isWordSized(value: string) {
  const text = value.replace(/(?:\s*,\s*[-–‑¨][^,;/|]*)+$/u, "").trim();
  if (!text || SENTENCE_END.test(text) || /[,，;；]/.test(text)) return false;
  return hasHan(text) ? (text.match(/\p{Script=Han}/gu) ?? []).length <= 4 : words(text) <= 3;
}

/** Free translations and long sentences cannot be judged by spelling. */
function judgeable(answer: string) {
  return hasHan(answer) ? (answer.match(/\p{Script=Han}/gu) ?? []).length <= 7 : words(answer) <= 4;
}

/** An alternative must be a real answer, not an article or a stray letter. */
function usable(part: string) {
  const text = part.trim();
  if (!text) return false;
  if (BARE_WORDS.has(text.toLocaleLowerCase())) return false;
  return hasHan(text) || letters(text) >= 2;
}

/**
 * Accepted answers from field values: "when; while; at the time of" → three answers;
 * "der Hund, -e" → "der Hund"; "Ja, ich weiß." stays one answer.
 */
export function acceptedAnswers(values: ExpectedAnswer[]) {
  const answers = new Set<string>();
  for (const entry of values) {
    const value = (typeof entry === "string" ? entry : entry.value).trim();
    const kind: AnswerKind = typeof entry === "string" ? "gloss" : entry.kind;
    if (!value) continue;
    answers.add(value);
    // German noun notation: plural / genitive endings after a comma are not part of the answer.
    const base = value.replace(/(?:\s*,\s*[-–‑¨][^,;/|]*)+$/u, "").trim();
    if (base && base !== value) answers.add(base);
    const strong = base.split(/\s*(?:[;；|/]|(?:^|\s)\d+[.)](?=\s))\s*/u).map((part) => part.trim()).filter(usable);
    for (const part of strong) answers.add(part);
    const listLike = kind === "gloss" && !hasHan(base) && !SENTENCE_END.test(base);
    if (!listLike) continue;
    for (const part of strong) {
      const pieces = part.split(/\s*[,，、]\s*|\s+or\s+/u).map((piece) => piece.trim()).filter(Boolean);
      if (pieces.length < 2 || pieces.some((piece) => words(piece) > 3)) continue;
      for (const piece of pieces) if (usable(piece)) answers.add(piece);
    }
  }
  return Array.from(answers);
}

export function suggestResult(typed: string, expectedValues: ExpectedAnswer[]): AnswerSuggestion | null {
  const attempt = normaliseAnswer(typed);
  if (!attempt) return null;
  const glossValues = new Set(expectedValues.filter((entry) => typeof entry === "string" || entry.kind === "gloss").map((entry) => (typeof entry === "string" ? entry : entry.value).trim()));
  const answers = acceptedAnswers(expectedValues);
  if (!answers.length) return null;
  let best: AnswerSuggestion | null = null;
  const rank = { good: 3, hard: 2, again: 1 } as const;
  const offer = (suggestion: AnswerSuggestion) => { if (!best || rank[suggestion.grade] > rank[best.grade]) best = suggestion; };
  // Which accepted answers came from glosses (English article rule applies to those only).
  const fromGloss = new Set(acceptedAnswers(Array.from(glossValues)));

  for (const answer of answers) {
    let target = normaliseAnswer(answer);
    if (!target) continue;
    const gloss = fromGloss.has(answer) && !hasHan(target) && !hasCyrillic(target);
    let a = gloss ? withoutGlossArticle(attempt) : attempt;
    if (gloss) target = withoutGlossArticle(target);
    const spaceless = hasHan(target) || /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(target);
    if (spaceless) a = compact(a);
    const t = spaceless ? compact(target) : target;
    if (a === t) { offer({ grade: "good", reason: "Matches the answer.", matched: answer }); continue; }
    if (withoutMarks(a) === withoutMarks(t)) {
      offer({ grade: "hard", reason: "Right letters; only the tone marks or accents differ.", matched: answer });
      continue;
    }
    const article = !gloss ? t.match(GERMAN_ARTICLE) : null;
    if (article && withoutMarks(a) === withoutMarks(article[2])) {
      offer({ grade: "hard", reason: `Right word; the article (${article[1]}) is missing.`, matched: answer });
      continue;
    }
    const length = Array.from(t).length;
    const allowed = hasHan(t) ? (length >= 4 ? 1 : 0) : length <= 3 ? 0 : length <= 6 ? 1 : 2;
    const gap = distance(withoutMarks(a), withoutMarks(t));
    if (allowed && gap <= allowed) offer({ grade: "hard", reason: `Almost: ${gap === 1 ? "one character differs" : `${gap} characters differ`}.`, matched: answer });
  }
  if (best) return best;
  // A long sentence typed differently may still be a good translation: no verdict.
  if (!answers.some(judgeable)) return null;
  return { grade: "again", reason: "Does not match the answer.", matched: null };
}
