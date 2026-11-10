import { acceptedAnswers, isWordSized, normaliseAnswer, numberedPinyinToMarks, suggestResult, type ExpectedAnswer } from "./answerCheck";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "./heuresis";
import { languageFromName, languageFromScript, type LanguageKey } from "./languages";
import { ROUND_SIZE, STAGE_ORDER, type LearnStage } from "./learnRounds";

/**
 * The five exercises of a Learning round.
 *
 * A round always moves from recognising the answer to producing it:
 *   1 Recognition → 2 Reconstruction → 3 Completion → 4 Context → 5 Active recall
 *
 * What each step actually asks depends on the card: a German noun is asked for its
 * gender, a verb for its preposition, a Chinese word for its tones and characters, a
 * Russian word for its stress, a sentence for its word order. Everything is built from
 * the card's own fields and from the other cards of the topic (as distractors); nothing
 * is invented and no AI service is called. When a card has too little data for a step,
 * another meaningful exercise takes its place, and the round still has exactly five.
 *
 * Pure and deterministic: the same (card, pool, round number, seed) gives the same round.
 */

export type ExerciseKind =
  | "choose-meaning" | "choose-term" | "build-term" | "build-sentence" | "fill-gaps"
  | "missing-character" | "choose-reading" | "choose-stress" | "choose-article" | "choose-preposition"
  | "cloze-choice" | "example-meaning" | "match-example" | "build-meaning" | "type-meaning"
  | "recall-type" | "recall-build" | "recall-guided";

export type Prompt = {
  /** Small line above the question, e.g. "What does this mean?". */
  ask: string;
  /** The thing being asked about, shown large. */
  text: string;
  /** Reading, translation or other support, shown smaller underneath. */
  sub?: string;
  /** BCP 47 tag for `text`, so fonts and input methods behave. */
  lang?: string;
};

type Base = {
  v: 1;
  position: number;
  stage: LearnStage;
  kind: ExerciseKind;
  prompt: Prompt;
  /** The complete right answer, as shown in feedback and stored with the attempt. */
  solution: string;
  /** One or two sentences worth reading after a wrong answer. */
  explain: string;
};

export type Choice = { id: string; label: string; lang?: string; /** What this option really is, for feedback. */ note?: string };
export type ChoiceExercise = Base & { format: "choice"; choices: Choice[]; answerId: string; layout: "list" | "grid" };
export type Tile = { id: string; text: string };
export type BuildExercise = Base & { format: "build"; tiles: Tile[]; /** Tile texts in the right order. */ answer: string[]; joiner: "" | " "; lang?: string };
export type GapCell = { ch: string; gap: boolean };
export type GapsExercise = Base & { format: "gaps"; cells: GapCell[]; bank: string[]; lang?: string };
export type TypeExercise = Base & {
  format: "type"; accepted: ExpectedAnswer[]; placeholder: string; lang?: string;
  /** First letters, offered on request. Using it means the answer was assisted (no points). */
  hint?: string;
  /** Language key used for spelling variants (German ae/oe/ue/ss). */
  language?: LanguageKey | null;
};
export type Exercise = ChoiceExercise | BuildExercise | GapsExercise | TypeExercise;

export type ExerciseInput =
  | { format: "choice"; choiceId: string }
  | { format: "build"; tileIds: string[] }
  | { format: "gaps"; letters: string[] }
  | { format: "type"; text: string };

export type Verdict = { correct: boolean; response: string; expected: string; message: string };

/* ------------------------------------------------------------------------- */
/* The card as Learn sees it                                                   */
/* ------------------------------------------------------------------------- */

export type LearnExample = { source: string; reading: string; translation: string };
export type LearnCard = {
  id: string;
  /** The term as written on the card. */
  term: string;
  /** One clean written form for tiles and gaps ("der Hund, -e" → "der Hund"). */
  form: string;
  reading: string;
  meaning: string;
  examples: LearnExample[];
  language: LanguageKey | null;
  han: boolean;
  wordSized: boolean;
};

const HAN = /\p{Script=Han}/u;
const HAN_ALL = /\p{Script=Han}/gu;
const LETTER = /[\p{L}\p{M}]/u;
const BCP: Partial<Record<LanguageKey, string>> = { zh: "zh-Hans", de: "de", ru: "ru", en: "en", fr: "fr", es: "es", it: "it", ja: "ja", ko: "ko" };

function clean(value: string) { return value.normalize("NFC").replace(/\s+/g, " ").trim(); }

/** "der Hund, -e" → "der Hund"; "machen / tun" → "machen"; "wissen (über)" → "wissen". */
export function writtenForm(term: string) {
  let text = clean(term).replace(/(?:\s*,\s*[-–‑¨][^,;/|]*)+$/u, "");
  text = text.split(/\s*(?:[;；|]|\s\/\s)\s*/u)[0] ?? text;
  text = text.replace(/\([^)]*\)|（[^）]*）/g, " ");
  return clean(text) || clean(term);
}

function workspaceExamples(card: CardWithStats): LearnExample[] {
  const raw = card.data["_workspace_blocks"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    try {
      const value = JSON.parse(entry) as Record<string, unknown>;
      if (value.type !== "example") return [];
      const source = clean(typeof value.source === "string" ? value.source : String(value.text ?? "").split("\n")[0]);
      if (!source) return [];
      return [{ source, reading: clean(typeof value.reading === "string" ? value.reading : ""), translation: clean(typeof value.translation === "string" ? value.translation : "") }];
    } catch { return []; }
  });
}

/** The language of a topic: its subject first, then its own title, then its card type. */
export function packLanguage(pack: PackWithType, collectionTitle?: string | null): LanguageKey | null {
  return languageFromName(collectionTitle) ?? languageFromName(pack.title) ?? languageFromName(pack.cardType?.name) ?? null;
}

export function toLearnCard(card: CardWithStats, pack: PackWithType, language: LanguageKey | null): LearnCard {
  const type = pack.cardType;
  const term = clean(fieldText(card.data, fieldByRole(type, "term")?.key ?? type?.field_schema[0]?.key));
  const meaning = clean(fieldText(card.data, fieldByRole(type, "meaning")?.key ?? type?.field_schema[1]?.key));
  const reading = clean(fieldText(card.data, fieldByRole(type, "reading")?.key));
  const example = clean(fieldText(card.data, fieldByRole(type, "example")?.key));
  const examples: LearnExample[] = [];
  if (example) {
    examples.push({
      source: example,
      reading: clean(fieldText(card.data, fieldByRole(type, "example_reading")?.key)),
      translation: clean(fieldText(card.data, fieldByRole(type, "example_translation")?.key)),
    });
  }
  for (const extra of workspaceExamples(card)) if (!examples.some((item) => item.source === extra.source)) examples.push(extra);
  const form = writtenForm(term);
  return {
    id: card.id, term, form, reading, meaning, examples,
    language: language ?? languageFromScript(term),
    han: HAN.test(form), wordSized: isWordSized(term),
  };
}

/** A card can be learned when it has something to ask and something to answer. */
export function learnable(card: LearnCard) { return Boolean(card.term && card.meaning); }

/* ------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* ------------------------------------------------------------------------- */

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A shuffle that never leaves the tiles already in the right order. */
function scramble<T>(items: T[], random: () => number, same: (a: T, b: T) => boolean): T[] {
  if (items.length < 2) return [...items];
  for (let tries = 0; tries < 6; tries += 1) {
    const mixed = shuffle(items, random);
    if (mixed.some((item, index) => !same(item, items[index]))) return mixed;
  }
  return [...items.slice(1), items[0]];
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const k = key(item); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/* ------------------------------------------------------------------------- */
/* Distractors from the same topic                                             */
/* ------------------------------------------------------------------------- */

function answerSet(meaning: string, wordSized: boolean) {
  return new Set(acceptedAnswers([{ value: meaning, kind: wordSized ? "gloss" : "exact" }]).map(normaliseAnswer).filter(Boolean));
}

/** Other cards whose meaning cannot be mistaken for a correct answer (no shared gloss). */
function meaningRivals(card: LearnCard, pool: LearnCard[]): LearnCard[] {
  const own = answerSet(card.meaning, card.wordSized);
  const ownTerm = normaliseAnswer(card.form);
  return uniqueBy(pool.filter((other) => {
    if (other.id === card.id || !other.meaning || !other.term || normaliseAnswer(other.form) === ownTerm) return false;
    for (const answer of answerSet(other.meaning, other.wordSized)) if (own.has(answer)) return false;
    return true;
  }), (other) => normaliseAnswer(other.meaning));
}

function words(value: string) { return value.trim().split(/\s+/).filter(Boolean).length; }

/** Plausible first: the same kind of expression (verb, noun, sentence) and a similar length. */
function byPlausibility(card: LearnCard, rivals: LearnCard[], random: () => number, field: "meaning" | "form"): LearnCard[] {
  const verb = (text: string) => /^to\s/i.test(text);
  const article = (text: string) => /^(der|die|das)\s/i.test(text);
  const score = (other: LearnCard) => {
    let value = random() * 0.9;
    if (verb(other.meaning) === verb(card.meaning)) value += 1.2;
    if (article(other.form) === article(card.form)) value += 0.8;
    if (other.wordSized === card.wordSized) value += 1;
    const a = field === "meaning" ? words(card.meaning) : Array.from(card.form).length;
    const b = field === "meaning" ? words(other.meaning) : Array.from(other.form).length;
    value += Math.max(0, 1 - Math.abs(a - b) / Math.max(2, a));
    return value;
  };
  return rivals.map((other) => ({ other, value: score(other) })).sort((x, y) => y.value - x.value).map((entry) => entry.other);
}

function pickRivals(card: LearnCard, pool: LearnCard[], random: () => number, field: "meaning" | "form", count = 3): LearnCard[] {
  let rivals = meaningRivals(card, pool);
  if (field === "form") rivals = uniqueBy(rivals, (other) => normaliseAnswer(other.form));
  // Choose among the most plausible, so a second round does not repeat the first.
  const ranked = byPlausibility(card, rivals, random, field).slice(0, Math.max(count, 6));
  return shuffle(ranked, random).slice(0, count);
}

/* ------------------------------------------------------------------------- */
/* Builders                                                                    */
/* ------------------------------------------------------------------------- */

type Context = { card: LearnCard; pool: LearnCard[]; round: number };
type Draft = Omit<ChoiceExercise, "position" | "stage" | "v"> | Omit<BuildExercise, "position" | "stage" | "v">
  | Omit<GapsExercise, "position" | "stage" | "v"> | Omit<TypeExercise, "position" | "stage" | "v">;
type Builder = (context: Context, random: () => number) => Draft | null;

const tag = (card: LearnCard) => (card.language ? BCP[card.language] : undefined) ?? (card.han ? "zh-Hans" : undefined);
const pair = (card: LearnCard) => `${card.form}${card.reading && card.han ? ` (${card.reading})` : ""} — ${card.meaning}`;
/** The answer as feedback shows it: Chinese with its reading. */
const written = (card: LearnCard) => `${card.form}${card.reading && card.han ? ` · ${card.reading}` : ""}`;

const chooseMeaning: Builder = ({ card, pool }, random) => {
  const rivals = pickRivals(card, pool, random, "meaning");
  if (rivals.length < 2) return null;
  const choices = shuffle<Choice>([
    { id: card.id, label: card.meaning },
    ...rivals.map((other) => ({ id: other.id, label: other.meaning, note: `${other.form} means “${other.meaning}”.` })),
  ], random);
  return {
    format: "choice", kind: "choose-meaning", layout: "list", choices, answerId: card.id,
    prompt: { ask: card.wordSized ? "What does this mean?" : "What does this say?", text: card.form, lang: tag(card) },
    solution: card.meaning, explain: `${pair(card)}.`,
  };
};

const chooseTerm: Builder = ({ card, pool }, random) => {
  const rivals = pickRivals(card, pool, random, "form");
  if (rivals.length < 2) return null;
  const choices = shuffle<Choice>([
    { id: card.id, label: card.form, lang: tag(card) },
    ...rivals.map((other) => ({ id: other.id, label: other.form, lang: tag(other), note: `${other.form} means “${other.meaning}”.` })),
  ], random);
  return {
    format: "choice", kind: "choose-term", layout: card.wordSized ? "grid" : "list", choices, answerId: card.id,
    prompt: { ask: card.wordSized ? "Which word or expression is this?" : "Which sentence says this?", text: card.meaning },
    solution: card.form, explain: `${pair(card)}.`,
  };
};

const VOWELS = "aeiouyäöüàâéèêëîïôùûœаеёиоуыэюя";
// Matched against lower-case text: a negated class combined with the i and u flags is unreliable.
const SYLLABLE = new RegExp(`[^${VOWELS}]*[${VOWELS}]+(?:[^${VOWELS}]*$|[^${VOWELS}]+(?=[^${VOWELS}]))?`, "gu");

/** Syllable-like pieces of one word (Ent·wick·lung); two-letter pieces when it is too short to split. */
function wordPieces(word: string): string[] {
  const letters = Array.from(word);
  if (letters.length <= 3) return [word];
  const lower = word.toLocaleLowerCase();
  const syllables = lower.length === word.length ? lower.match(SYLLABLE) ?? [] : [];
  if (syllables.length >= 2 && syllables.join("") === lower) {
    let at = 0;
    return syllables.map((syllable) => { const piece = word.slice(at, at + syllable.length); at += syllable.length; return piece; });
  }
  const pieces: string[] = [];
  for (let i = 0; i < letters.length; i += 2) pieces.push(letters.slice(i, i + 2).join(""));
  if (pieces.length > 1 && Array.from(pieces[pieces.length - 1]).length === 1) {
    const tail = pieces.pop()!;
    pieces[pieces.length - 1] += tail;
  }
  return pieces;
}

function hanPieces(text: string): string[] {
  const chars = Array.from(text).filter((char) => HAN.test(char) || /[\p{L}\p{N}]/u.test(char));
  if (chars.length <= 6) return chars;
  // Longer sentences are built from words, which is what sentence construction means in Chinese.
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: string }) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Segmenter) {
    try {
      const parts = [...new Segmenter("zh", { granularity: "word" }).segment(text)].filter((part) => part.isWordLike).map((part) => part.segment);
      if (parts.length >= 3 && parts.length <= 12) return parts;
    } catch { /* fall back to characters */ }
  }
  return chars.length <= 12 ? chars : [];
}

const COMMON_HAN = Array.from("的一是不了人我在有他这中大来上个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让");

function hanDistractors(card: LearnCard, pool: LearnCard[], random: () => number, count: number): string[] {
  const own = new Set(Array.from(card.form));
  const fromTopic = uniqueBy(pool.filter((other) => other.id !== card.id).flatMap((other) => other.form.match(HAN_ALL) ?? []), (char) => char)
    .filter((char) => !own.has(char));
  const chosen = shuffle(fromTopic, random).slice(0, count);
  if (chosen.length < count) {
    const extra = shuffle(COMMON_HAN.filter((char) => !own.has(char) && !chosen.includes(char)), random);
    chosen.push(...extra.slice(0, count - chosen.length));
  }
  return chosen;
}

/** Pieces of the same kind (whole words, or parts of words) taken from the other cards of the topic. */
function pieceDistractors(card: LearnCard, pool: LearnCard[], random: () => number, own: string[], count: number, unit: "words" | "parts"): string[] {
  const taken = new Set(own.map((piece) => piece.trim().toLocaleLowerCase()));
  const candidates = uniqueBy(pool.filter((other) => other.id !== card.id && other.han === card.han).flatMap((other) => {
    if (other.han) return hanPieces(other.form);
    const tokens = other.form.split(" ").filter(Boolean);
    return unit === "words" ? tokens : tokens.flatMap(wordPieces).filter((piece) => Array.from(piece).length >= 2);
  }), (piece) => piece.toLocaleLowerCase()).filter((piece) => !taken.has(piece.toLocaleLowerCase()));
  return shuffle(candidates, random).slice(0, count);
}

function termPieces(card: LearnCard, unit?: "words"): { pieces: string[]; joiner: "" | " " } {
  if (card.han) return { pieces: hanPieces(card.form), joiner: "" };
  const tokens = card.form.split(" ").filter(Boolean);
  if (tokens.length >= 3 || (unit === "words" && tokens.length === 2)) return { pieces: tokens, joiner: " " };
  // Parts of words. A piece that ends a word carries the space, so "der Hund" is rebuilt as two words.
  const pieces = tokens.flatMap((token, index) => {
    const parts = wordPieces(token);
    if (index < tokens.length - 1) parts[parts.length - 1] += " ";
    return parts;
  });
  return { pieces, joiner: "" };
}

/** Tiles in a shuffled order that is never already the solution. `texts` starts with the right order. */
function tiles(texts: string[], random: () => number): Tile[] {
  const made = texts.map((text, index) => ({ id: `t${index}`, text }));
  return scramble(made, random, (a, b) => a.text === b.text);
}

function buildFrom(card: LearnCard, pool: LearnCard[], random: () => number, options: { kind: "build-term" | "recall-build"; showReading: boolean; extra: number }): Draft | null {
  const withDistractors = (term: { pieces: string[]; joiner: "" | " " }) => {
    const wanted = Math.max(options.extra, 4 - term.pieces.length);
    const distractors = card.han && term.pieces.every((piece) => Array.from(piece).length === 1)
      ? hanDistractors(card, pool, random, wanted)
      : pieceDistractors(card, pool, random, term.pieces, wanted, term.joiner === " " ? "words" : "parts");
    return { ...term, distractors };
  };
  let built = withDistractors(termPieces(card));
  if (!card.han && built.joiner === "" && built.pieces.length > 7) {
    // Two long words are put together as words: a dozen syllables would be a chore, not a reconstruction.
    const whole = withDistractors(termPieces(card, "words"));
    if (whole.joiner === " " && whole.distractors.length >= 2) built = whole;
  }
  const { pieces, joiner, distractors } = built;
  if (pieces.length < 1 || pieces.length > 12) return null;
  const all = [...pieces, ...distractors];
  // Two tiles with nothing to tell them apart would be a coin toss, not reconstruction.
  if (all.length < 3 || (pieces.length < 2 && all.length < 4)) return null;
  const unit = card.han ? (pieces.every((piece) => Array.from(piece).length === 1) ? "characters" : "words") : joiner === " " ? "words" : "parts";
  return {
    format: "build", kind: options.kind, tiles: tiles(all, random), answer: pieces, joiner, lang: tag(card),
    prompt: {
      ask: options.kind === "recall-build"
        ? `Build it from memory. Not every ${unit === "parts" ? "part" : unit.slice(0, -1)} belongs.`
        : `Put the ${unit} in order${distractors.length ? `. Not every ${unit === "parts" ? "part" : unit.slice(0, -1)} belongs.` : "."}`,
      text: card.meaning,
      sub: options.showReading && card.reading && card.han ? card.reading : undefined,
    },
    // The meaning is the question and the answer is shown in full: nothing more needs saying.
    solution: written(card), explain: "",
  };
}

const buildTerm: Builder = ({ card, pool, round }, random) =>
  // The reading supports the first round only; afterwards the characters come from memory.
  buildFrom(card, pool, random, { kind: "build-term", showReading: round === 1, extra: card.han ? 3 : 2 });

const recallBuild: Builder = ({ card, pool }, random) =>
  buildFrom(card, pool, random, { kind: "recall-build", showReading: false, extra: card.han ? 4 : 3 });

function sentencePieces(example: LearnExample, han: boolean): { pieces: string[]; joiner: "" | " " } {
  if (han) return { pieces: hanPieces(example.source), joiner: "" };
  const tokens = example.source.split(" ").map((token) => token.replace(/^[„“"'«(]+|[.,!?;:…”"'»)]+$/gu, "")).filter(Boolean);
  return { pieces: tokens, joiner: " " };
}

function exampleFor(card: LearnCard, round: number, need: (example: LearnExample) => boolean): LearnExample | null {
  const usable = card.examples.filter(need);
  return usable.length ? usable[(round - 1) % usable.length] : null;
}

const buildSentence: Builder = ({ card, round }, random) => {
  const example = exampleFor(card, round, (item) => {
    const { pieces } = sentencePieces(item, HAN.test(item.source));
    return pieces.length >= 4 && pieces.length <= 11;
  });
  if (!example) return null;
  const han = HAN.test(example.source);
  const { pieces, joiner } = sentencePieces(example, han);
  if (new Set(pieces).size < 3) return null;
  return {
    format: "build", kind: "build-sentence", tiles: tiles(pieces, random), answer: pieces, joiner, lang: tag(card),
    prompt: {
      ask: example.translation ? "Build the sentence that says this." : `Build the example sentence for “${card.form}”.`,
      text: example.translation || card.meaning,
      sub: example.translation ? undefined : card.form,
    },
    solution: example.source,
    explain: `${example.source}${example.translation ? ` — ${example.translation}` : ""}`,
  };
};

const EXTRA_LETTERS: Partial<Record<LanguageKey, string>> = { de: "enisrtäöüßhc", ru: "оеаинтсрвлк", fr: "esaitnréèç", es: "eaosrnñí", it: "eaionlrt" };

const fillGaps: Builder = ({ card, round }, random) => {
  if (card.han) return null;
  const chars = Array.from(card.form);
  const letterAt = chars.map((char) => LETTER.test(char) && !/\p{M}/u.test(char));
  // The first letter of each word stays as an anchor; in a sentence only the longest words are opened.
  const wordIndex: number[] = []; let word = 0;
  chars.forEach((char, index) => { if (char === " ") word += 1; wordIndex[index] = word; });
  const wordLength = new Map<number, number>();
  chars.forEach((_, index) => { if (letterAt[index]) wordLength.set(wordIndex[index], (wordLength.get(wordIndex[index]) ?? 0) + 1); });
  const allowedWords = wordLength.size >= 4
    ? new Set([...wordLength.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([index]) => index)) : null;
  const eligible = chars.map((_, index) => index).filter((index) => {
    if (!letterAt[index]) return false;
    if (allowedWords && !allowedWords.has(wordIndex[index])) return false;
    const first = index === 0 || chars[index - 1] === " ";
    return !first || (wordLength.get(wordIndex[index]) ?? 0) <= 2;
  });
  const total = letterAt.filter(Boolean).length;
  if (total < 4 || eligible.length < 2) return null;
  const share = round === 1 ? 0.4 : 0.6;
  const count = Math.max(2, Math.min(8, eligible.length, Math.round(total * share)));
  const open = new Set(shuffle(eligible, random).slice(0, count));
  const cells: GapCell[] = chars.map((ch, index) => ({ ch, gap: open.has(index) }));
  const missing = cells.filter((cell) => cell.gap).map((cell) => cell.ch);
  const present = new Set(missing.map((ch) => ch.toLocaleLowerCase()));
  const alphabet = Array.from(EXTRA_LETTERS[card.language ?? "en"] ?? (/\p{Script=Cyrillic}/u.test(card.form) ? EXTRA_LETTERS.ru! : "etaoinsrhl"));
  const extras = shuffle(alphabet.filter((ch) => !present.has(ch)), random).slice(0, Math.min(3, Math.max(2, 8 - missing.length)));
  return {
    format: "gaps", kind: "fill-gaps", cells, bank: shuffle([...missing, ...extras], random), lang: tag(card),
    prompt: { ask: "Fill in the missing letters.", text: card.meaning },
    solution: card.form, explain: "",
  };
};

const missingCharacter: Builder = ({ card, pool, round }, random) => {
  if (!card.han) return null;
  const chars = Array.from(card.form);
  const positions = chars.map((char, index) => (HAN.test(char) ? index : -1)).filter((index) => index >= 0);
  if (positions.length < 2) return null;
  const at = positions[(hash(card.id) + round - 1) % positions.length];
  const answer = chars[at];
  const choices = shuffle<Choice>([answer, ...hanDistractors(card, pool, random, 3)].map((char) => ({ id: char, label: char, lang: "zh-Hans" })), random);
  return {
    format: "choice", kind: "missing-character", layout: "grid", choices, answerId: answer,
    prompt: {
      ask: "Which character is missing?",
      text: chars.map((char, index) => (index === at ? "＿" : char)).join(""),
      sub: [card.reading, card.meaning].filter(Boolean).join(" · "), lang: "zh-Hans",
    },
    solution: card.form, explain: `${pair(card)}.`,
  };
};

const TONES: Record<string, string> = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };
const TONED = new Map<string, { base: string; tone: number }>();
for (const [base, marks] of Object.entries(TONES)) Array.from(marks).forEach((mark, index) => TONED.set(mark, { base, tone: index }));
const TONE_NAME = ["1st", "2nd", "3rd", "4th"];

const chooseReading: Builder = ({ card }, random) => {
  if (!card.han || !card.reading) return null;
  const reading = numberedPinyinToMarks(card.reading).normalize("NFC");
  const chars = Array.from(reading);
  const toned = chars.map((char, index) => (TONED.has(char.toLocaleLowerCase()) ? index : -1)).filter((index) => index >= 0);
  if (!toned.length || toned.length > 6) return null;
  const retone = (index: number, tone: number, from: string[]) => {
    const info = TONED.get(from[index].toLocaleLowerCase())!;
    const next = [...from];
    const mark = Array.from(TONES[info.base])[tone];
    next[index] = from[index] === from[index].toLocaleLowerCase() ? mark : mark.toLocaleUpperCase();
    return next;
  };
  const variants = new Set<string>();
  for (const index of toned) {
    const current = TONED.get(chars[index].toLocaleLowerCase())!.tone;
    for (let tone = 0; tone < 4; tone += 1) if (tone !== current) variants.add(retone(index, tone, chars).join(""));
  }
  if (toned.length >= 2) {
    // Two syllables with their tones exchanged is the classic confusion.
    const [first, second] = toned;
    const a = TONED.get(chars[first].toLocaleLowerCase())!.tone;
    const b = TONED.get(chars[second].toLocaleLowerCase())!.tone;
    if (a !== b) variants.add(retone(second, a, retone(first, b, chars)).join(""));
  }
  variants.delete(reading);
  const wrong = shuffle([...variants], random).slice(0, 3);
  if (wrong.length < 2) return null;
  const tones = toned.map((index) => TONE_NAME[TONED.get(chars[index].toLocaleLowerCase())!.tone]).join(" + ");
  const choices = shuffle<Choice>([reading, ...wrong].map((label) => ({ id: label, label, lang: "zh-Latn" })), random);
  return {
    format: "choice", kind: "choose-reading", layout: "grid", choices, answerId: reading,
    prompt: { ask: "Which pinyin has the right tones?", text: card.form, sub: card.meaning, lang: "zh-Hans" },
    solution: reading, explain: `${card.form} is read ${reading} (${tones} tone).`,
  };
};

const STRESS = "́";
const RU_VOWELS = "аеиоуыэюя";

const chooseStress: Builder = ({ card }, random) => {
  const source = [card.reading, card.term].find((value) => value.normalize("NFD").includes(STRESS));
  if (!source || !/\p{Script=Cyrillic}/u.test(source)) return null;
  const decomposed = source.normalize("NFD").replace(/[̀̂-ͯ]/g, (mark) => (mark === STRESS ? mark : ""));
  if (decomposed.split(STRESS).length !== 2 || /\s/.test(decomposed.trim()) || /ё/i.test(decomposed)) return null;
  const plain = Array.from(decomposed.replace(STRESS, "").normalize("NFC"));
  const stressedAt = Array.from(decomposed.slice(0, decomposed.indexOf(STRESS)).normalize("NFC")).length - 1;
  const vowels = plain.map((char, index) => (RU_VOWELS.includes(char.toLocaleLowerCase()) ? index : -1)).filter((index) => index >= 0);
  if (vowels.length < 2 || !vowels.includes(stressedAt)) return null;
  const mark = (index: number) => [...plain.slice(0, index + 1), STRESS, ...plain.slice(index + 1)].join("").normalize("NFC");
  const others = shuffle(vowels.filter((index) => index !== stressedAt), random).slice(0, 3);
  const choices = [stressedAt, ...others].sort((a, b) => a - b).map<Choice>((index) => ({ id: String(index), label: mark(index), lang: "ru" }));
  return {
    format: "choice", kind: "choose-stress", layout: "grid", choices, answerId: String(stressedAt),
    prompt: { ask: "Where does the stress fall?", text: plain.join(""), sub: card.meaning, lang: "ru" },
    solution: mark(stressedAt), explain: `${mark(stressedAt)} — the stress is on the ${ordinal(vowels.indexOf(stressedAt) + 1)} syllable.`,
  };
};

function ordinal(n: number) { return ["first", "second", "third", "fourth", "fifth", "sixth"][n - 1] ?? `${n}th`; }

const GENDER: Record<string, string> = { der: "masculine", die: "feminine", das: "neuter" };
const GENDER_RULES: Array<[RegExp, string]> = [
  [/(ung|heit|keit|schaft|tion|tät)$/i, "die"],
  [/(chen|lein)$/i, "das"],
  [/(ling|ismus)$/i, "der"],
];

const chooseArticle: Builder = ({ card }) => {
  if (card.language !== "de") return null;
  const match = card.form.match(/^(der|die|das)\s+(\p{Lu}[\p{L}\p{M}-]+)$/u);
  if (!match) return null;
  const article = match[1].toLocaleLowerCase(); const noun = match[2];
  const rule = GENDER_RULES.find(([pattern, gender]) => pattern.test(noun) && gender === article);
  const ending = rule ? noun.match(rule[0])?.[0] : null;
  const choices: Choice[] = ["der", "die", "das"].map((label) => ({ id: label, label, lang: "de" }));
  return {
    format: "choice", kind: "choose-article", layout: "grid", choices, answerId: article,
    prompt: { ask: "Which article goes with this noun?", text: `＿ ${noun}`, sub: card.meaning, lang: "de" },
    solution: `${article} ${noun}`,
    explain: `${article} ${noun} is ${GENDER[article]}.${ending ? ` Nouns ending in -${ending.toLocaleLowerCase()} take ${article}.` : ""}`,
  };
};

const DE_PREPOSITIONS = ["an", "auf", "aus", "bei", "für", "gegen", "in", "mit", "nach", "über", "um", "unter", "von", "vor", "zu"];

const choosePreposition: Builder = ({ card }, random) => {
  if (card.language !== "de") return null;
  const tokens = card.form.split(" ");
  if (tokens.length < 2 || tokens.length > 4) return null;
  const at = tokens.length - 1;
  const preposition = tokens[at].toLocaleLowerCase();
  if (!DE_PREPOSITIONS.includes(preposition) || /^(der|die|das)$/i.test(tokens[0])) return null;
  const wrong = shuffle(DE_PREPOSITIONS.filter((item) => item !== preposition), random).slice(0, 3);
  const choices = shuffle<Choice>([preposition, ...wrong].map((label) => ({ id: label, label, lang: "de" })), random);
  return {
    format: "choice", kind: "choose-preposition", layout: "grid", choices, answerId: preposition,
    prompt: { ask: "Which preposition completes the expression?", text: [...tokens.slice(0, at), "＿"].join(" "), sub: card.meaning, lang: "de" },
    solution: card.form, explain: `${card.form} — ${card.meaning}. The verb takes “${preposition}”.`,
  };
};

const STOP = new Set(["der", "die", "das", "den", "dem", "des", "ein", "eine", "sich", "to", "the", "a", "an", "se", "le", "la", "les", "el", "los", "las", ...DE_PREPOSITIONS]);
const SEPARABLE = ["zurück", "heraus", "herein", "hinaus", "weiter", "ab", "an", "auf", "aus", "bei", "ein", "mit", "nach", "vor", "weg", "zu"];

function fold(text: string) {
  return text.normalize("NFD").replace(/́/g, "").normalize("NFC").toLocaleLowerCase();
}

/** Where the card's word appears in a sentence, allowing for inflection (freuen → freue, говорить → говорю). */
export function locateInSentence(card: Pick<LearnCard, "form" | "han" | "language">, sentence: string): { start: number; end: number } | null {
  const text = fold(sentence);
  if (text.length !== sentence.length) return null; // Indices must line up with what is shown.
  const whole = fold(card.form);
  if (card.han) {
    const compact = whole.replace(/\s+/g, "");
    const at = text.indexOf(compact);
    return at >= 0 && compact ? { start: at, end: at + compact.length } : null;
  }
  const exact = text.indexOf(whole);
  if (exact >= 0 && whole.length >= 3) {
    const before = exact === 0 || !LETTER.test(text[exact - 1]);
    const after = exact + whole.length >= text.length || !LETTER.test(text[exact + whole.length]);
    if (before && after) return { start: exact, end: exact + whole.length };
  }
  const content = whole.split(" ").filter((token) => token && !STOP.has(token)).sort((a, b) => b.length - a.length);
  const keys = content.slice(0, 1);
  if (card.language === "de" && keys[0]) {
    const prefix = SEPARABLE.find((item) => keys[0].startsWith(item) && keys[0].length - item.length >= 4);
    if (prefix) keys.push(keys[0].slice(prefix.length));
  }
  for (const key of keys) {
    const length = Array.from(key).length;
    if (length < 3) continue;
    const stem = Array.from(key).slice(0, Math.max(3, Math.min(length, Math.round(length * 0.6)))).join("");
    for (const match of text.matchAll(/[\p{L}\p{M}]+/gu)) {
      if (match[0].startsWith(stem) && match.index !== undefined) return { start: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

const clozeChoice: Builder = ({ card, pool, round }, random) => {
  const example = exampleFor(card, round, (item) => Boolean(locateInSentence(card, item.source)));
  if (!example) return null;
  const rivals = pickRivals(card, pool, random, "form");
  if (rivals.length < 2) return null;
  const range = locateInSentence(card, example.source)!;
  const gapped = `${example.source.slice(0, range.start)}＿＿＿${example.source.slice(range.end)}`;
  const choices = shuffle<Choice>([
    { id: card.id, label: card.form, lang: tag(card) },
    ...rivals.map((other) => ({ id: other.id, label: other.form, lang: tag(other), note: `${other.form} means “${other.meaning}”.` })),
  ], random);
  return {
    format: "choice", kind: "cloze-choice", layout: card.wordSized ? "grid" : "list", choices, answerId: card.id,
    prompt: { ask: "Which word belongs in this sentence?", text: gapped, sub: example.translation || undefined, lang: tag(card) },
    solution: card.form,
    explain: `${example.source}${example.translation ? ` — ${example.translation}` : ""}`,
  };
};

const exampleMeaning: Builder = ({ card, pool, round }, random) => {
  const example = exampleFor(card, round, (item) => Boolean(item.translation));
  if (!example) return null;
  const others = uniqueBy(pool.filter((other) => other.id !== card.id).flatMap((other) => other.examples.filter((item) => item.translation)),
    (item) => normaliseAnswer(item.translation)).filter((item) => normaliseAnswer(item.translation) !== normaliseAnswer(example.translation));
  if (others.length < 2) return null;
  const wrong = shuffle(others, random).slice(0, 3);
  const choices = shuffle<Choice>([
    { id: "answer", label: example.translation },
    ...wrong.map((item, index) => ({ id: `w${index}`, label: item.translation, note: `That is “${item.source}”.` })),
  ], random);
  return {
    format: "choice", kind: "example-meaning", layout: "list", choices, answerId: "answer",
    prompt: { ask: "What does this sentence mean?", text: example.source, sub: example.reading || undefined, lang: tag(card) },
    solution: example.translation, explain: `${example.source} — ${example.translation}`,
  };
};

/** For knowledge cards: which concept does this explanation belong to? */
const matchExample: Builder = ({ card, pool, round }, random) => {
  if (card.han || card.language) return null;
  const example = exampleFor(card, round, (item) => words(item.source) >= 5);
  if (!example) return null;
  const rivals = pickRivals(card, pool, random, "form");
  if (rivals.length < 2) return null;
  const range = locateInSentence(card, example.source);
  const shown = range ? `${example.source.slice(0, range.start)}＿＿＿${example.source.slice(range.end)}` : example.source;
  const choices = shuffle<Choice>([
    { id: card.id, label: card.form },
    ...rivals.map((other) => ({ id: other.id, label: other.form, note: `${other.form}: ${other.meaning}` })),
  ], random);
  return {
    format: "choice", kind: "match-example", layout: "list", choices, answerId: card.id,
    prompt: { ask: "Which concept does this describe?", text: shown },
    solution: card.form, explain: `${card.form}: ${card.meaning}`,
  };
};

/**
 * A definition put back in order (knowledge cards, and any card whose meaning is a full
 * phrase). Built from the card alone, so it also works in a topic with no other cards.
 */
const buildMeaning: Builder = ({ card }, random) => {
  const pieces = card.meaning.split(" ").map((token) => token.replace(/^[„“"'«(]+|[.,!?;:…”"'»)]+$/gu, "")).filter(Boolean);
  if (pieces.length < 5 || pieces.length > 12 || new Set(pieces.map((piece) => piece.toLocaleLowerCase())).size < 4) return null;
  return {
    format: "build", kind: "build-meaning", tiles: tiles(pieces, random), answer: pieces, joiner: " ",
    prompt: {
      ask: card.wordSized ? "Put its definition in order." : "Put the translation in order.",
      text: card.form, sub: card.han && card.reading ? card.reading : undefined, lang: tag(card),
    },
    solution: card.meaning, explain: `${pair(card)}.`,
  };
};

/** The other direction, for a short meaning: the word is shown and its meaning is typed. */
const typeMeaning: Builder = ({ card }) => {
  const glosses = acceptedAnswers([{ value: card.meaning, kind: card.wordSized ? "gloss" : "exact" }]);
  if (!glosses.length || !glosses.some((gloss) => words(gloss) <= 3)) return null;
  return {
    format: "type", kind: "type-meaning", accepted: [{ value: card.meaning, kind: card.wordSized ? "gloss" : "exact" }],
    placeholder: "Type the meaning", language: null,
    prompt: { ask: "What does it mean? Type it.", text: card.form, sub: card.han && card.reading ? card.reading : undefined, lang: tag(card) },
    solution: card.meaning, explain: `${pair(card)}.`,
  };
};

function firstLetters(form: string) {
  return form.split(" ").map((word) => {
    const letters = Array.from(word);
    return letters[0] + "·".repeat(Math.max(0, letters.length - 1));
  }).join(" ");
}

const recallType: Builder = ({ card }) => {
  const accepted: ExpectedAnswer[] = [{ value: card.term, kind: "exact" }];
  if (card.form !== card.term) accepted.push({ value: card.form, kind: "exact" });
  if (card.han && card.reading) accepted.push({ value: card.reading, kind: "exact" });
  return {
    format: "type", kind: "recall-type", accepted, lang: tag(card), language: card.language,
    placeholder: card.han ? (card.reading ? "Characters, or pinyin with tones (yi3 qian2)" : "Type the characters") : "Type your answer",
    hint: card.han ? undefined : firstLetters(card.form),
    prompt: { ask: card.wordSized ? "Write it from memory." : "Write the sentence from memory.", text: card.meaning },
    solution: written(card), explain: "",
  };
};

/** Last resort for a card with almost no data: the answer is typed with its outline shown. */
const recallGuided: Builder = ({ card }) => ({
  format: "type", kind: "recall-guided", accepted: [{ value: card.term, kind: "exact" }, { value: card.form, kind: "exact" }],
  lang: tag(card), language: card.language, placeholder: "Type the whole answer",
  prompt: { ask: "Complete it from its outline.", text: card.meaning, sub: card.han ? card.reading || undefined : firstLetters(card.form) },
  solution: written(card), explain: "",
});

const BUILDERS: Record<ExerciseKind, Builder> = {
  "choose-meaning": chooseMeaning, "choose-term": chooseTerm, "build-term": buildTerm, "build-sentence": buildSentence,
  "fill-gaps": fillGaps, "missing-character": missingCharacter, "choose-reading": chooseReading, "choose-stress": chooseStress,
  "choose-article": chooseArticle, "choose-preposition": choosePreposition, "cloze-choice": clozeChoice,
  "example-meaning": exampleMeaning, "match-example": matchExample, "build-meaning": buildMeaning, "type-meaning": typeMeaning,
  "recall-type": recallType, "recall-build": recallBuild, "recall-guided": recallGuided,
};

/** Each step's preferred exercises, best first. A later round takes the next one that fits the card. */
const STEP_KINDS: Record<LearnStage, ExerciseKind[]> = {
  recognition: ["choose-meaning", "choose-term"],
  reconstruction: ["build-term", "build-sentence"],
  completion: ["choose-article", "choose-preposition", "missing-character", "choose-stress", "fill-gaps", "choose-reading"],
  context: ["cloze-choice", "match-example", "example-meaning", "build-sentence", "build-meaning", "choose-reading", "choose-stress", "choose-term", "choose-meaning"],
  recall: ["recall-type"],
};

/** When a step has nothing that fits, any other meaningful exercise not yet used in the round. */
const SUBSTITUTES: ExerciseKind[] = [
  "choose-meaning", "choose-term", "fill-gaps", "build-term", "missing-character", "choose-reading",
  "choose-stress", "cloze-choice", "example-meaning", "build-sentence", "build-meaning", "type-meaning", "recall-guided",
];

function longAnswer(card: LearnCard) {
  return card.han ? (card.form.match(HAN_ALL) ?? []).length > 7 : words(card.form) > 4;
}

/**
 * Builds the five exercises of one round for one card.
 * `pool` is the other cards of the topic (learning or not); they only supply distractors.
 */
export function buildRound(input: { card: LearnCard; pool: LearnCard[]; round: number; seed: string }): Exercise[] {
  const { card } = input;
  if (!learnable(card)) throw new Error("This card needs a term and a meaning before it can be learned.");
  const round = Math.max(1, Math.floor(input.round));
  const used = new Set<ExerciseKind>();
  const plan: Exercise[] = [];

  const attempt = (kind: ExerciseKind, position: number, stage: LearnStage): Exercise | null => {
    const draft = BUILDERS[kind]({ card, pool: input.pool, round }, rng(`${input.seed}:${position}:${kind}`));
    return draft ? { ...draft, v: 1, position, stage } as Exercise : null;
  };

  STAGE_ORDER.forEach((stage, index) => {
    const position = index + 1;
    let preferred = STEP_KINDS[stage];
    // A long sentence is produced by building it without help; typing it letter-perfect proves little more.
    if (stage === "recall" && longAnswer(card)) preferred = ["recall-build", "recall-type"];
    const fitting = preferred.filter((kind) => !used.has(kind)).map((kind) => attempt(kind, position, stage)).filter((item): item is Exercise => Boolean(item));
    let chosen: Exercise | null = fitting.length
      ? fitting[stage === "recall" ? 0 : (round - 1) % fitting.length] : null;
    if (!chosen) {
      for (const kind of SUBSTITUTES) {
        if (used.has(kind)) continue;
        chosen = attempt(kind, position, stage);
        if (chosen) break;
      }
    }
    // A card with a term and a meaning can always be asked for from its outline or from memory.
    chosen ??= attempt(stage === "recall" ? "recall-type" : "recall-guided", position, stage)!;
    used.add(chosen.kind);
    plan.push(chosen);
  });
  return plan;
}

/* ------------------------------------------------------------------------- */
/* Checking                                                                    */
/* ------------------------------------------------------------------------- */

const germanFold = (value: string) => value.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

function compactFold(value: string) {
  return normaliseAnswer(value).replace(/\s+/g, "");
}

function checkTyped(exercise: TypeExercise, text: string): Verdict {
  const typed = clean(text);
  const expected = exercise.solution;
  if (!typed) return { correct: false, response: "", expected, message: exercise.explain };
  const suggestion = suggestResult(typed, exercise.accepted);
  if (suggestion?.grade === "good") return { correct: true, response: typed, expected, message: "" };
  const values = acceptedAnswers(exercise.accepted);
  // Capitals, punctuation and spacing are not what is being learned.
  if (values.some((value) => compactFold(value) === compactFold(typed))) return { correct: true, response: typed, expected, message: "" };
  // ae / oe / ue / ss is how German is written without the keys for ä ö ü ß.
  if (exercise.language === "de" && values.some((value) => germanFold(normaliseAnswer(value)) === germanFold(normaliseAnswer(typed)))) {
    return { correct: true, response: typed, expected, message: "" };
  }
  let reason = suggestion?.grade === "hard" ? suggestion.reason : "";
  if (reason && /tone marks or accents/.test(reason) && exercise.accepted.some((entry) => HAN.test(typeof entry === "string" ? entry : entry.value))) {
    reason = "Right syllables, but the tones are missing or different. Tones can be typed as numbers (yi3 qian2).";
  }
  return { correct: false, response: typed, expected, message: [reason, exercise.explain].filter(Boolean).join(" ") };
}

export function checkExercise(exercise: Exercise, input: ExerciseInput): Verdict {
  if (exercise.format === "choice" && input.format === "choice") {
    const chosen = exercise.choices.find((choice) => choice.id === input.choiceId);
    const right = exercise.choices.find((choice) => choice.id === exercise.answerId);
    const correct = Boolean(chosen) && input.choiceId === exercise.answerId;
    return {
      correct, response: chosen?.label ?? "", expected: right?.label ?? exercise.solution,
      message: correct ? "" : [chosen?.note, exercise.explain].filter(Boolean).join(" "),
    };
  }
  if (exercise.format === "build" && input.format === "build") {
    const byId = new Map(exercise.tiles.map((tile) => [tile.id, tile.text]));
    const built = input.tileIds.map((id) => byId.get(id) ?? "");
    const correct = built.join("") === exercise.answer.join("");
    const firstWrong = built.findIndex((text, index) => text !== exercise.answer[index]);
    const where = !correct && firstWrong > 0 ? `Right as far as “${built.slice(0, firstWrong).join(exercise.joiner)}”. ` : "";
    return { correct, response: built.join(exercise.joiner), expected: exercise.solution, message: correct ? "" : `${where}${exercise.explain}` };
  }
  if (exercise.format === "gaps" && input.format === "gaps") {
    let at = 0;
    const filled = exercise.cells.map((cell) => (cell.gap ? input.letters[at++] ?? "" : cell.ch)).join("");
    const correct = filled.normalize("NFC").toLocaleLowerCase() === exercise.solution.normalize("NFC").toLocaleLowerCase();
    return { correct, response: filled, expected: exercise.solution, message: correct ? "" : exercise.explain };
  }
  if (exercise.format === "type" && input.format === "type") return checkTyped(exercise, input.text);
  return { correct: false, response: "", expected: exercise.solution, message: exercise.explain };
}

/* ------------------------------------------------------------------------- */
/* Reading a stored round back                                                 */
/* ------------------------------------------------------------------------- */

function isPrompt(value: unknown): value is Prompt {
  return Boolean(value && typeof value === "object" && typeof (value as Prompt).ask === "string" && typeof (value as Prompt).text === "string");
}

function isExercise(value: unknown, position: number): value is Exercise {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.v !== 1 || item.position !== position || item.stage !== STAGE_ORDER[position - 1]) return false;
  if (!isPrompt(item.prompt) || typeof item.solution !== "string" || typeof item.explain !== "string" || typeof item.kind !== "string") return false;
  if (item.format === "choice") {
    return Array.isArray(item.choices) && item.choices.length >= 2 && typeof item.answerId === "string"
      && item.choices.every((choice) => choice && typeof (choice as Choice).id === "string" && typeof (choice as Choice).label === "string")
      && item.choices.some((choice) => (choice as Choice).id === item.answerId);
  }
  if (item.format === "build") {
    return Array.isArray(item.tiles) && Array.isArray(item.answer) && item.answer.length >= 1
      && item.tiles.every((tile) => tile && typeof (tile as Tile).id === "string" && typeof (tile as Tile).text === "string");
  }
  if (item.format === "gaps") {
    return Array.isArray(item.cells) && Array.isArray(item.bank)
      && item.cells.every((cell) => cell && typeof (cell as GapCell).ch === "string" && typeof (cell as GapCell).gap === "boolean");
  }
  if (item.format === "type") return Array.isArray(item.accepted) && item.accepted.length >= 1;
  return false;
}

/** The exercises of a stored round, or null when it was written by an incompatible version. */
export function readPlan(plan: unknown): Exercise[] | null {
  if (!Array.isArray(plan) || plan.length !== ROUND_SIZE) return null;
  return plan.every((item, index) => isExercise(item, index + 1)) ? plan as Exercise[] : null;
}
