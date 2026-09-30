import { supabase } from "./supabase";
import { fieldByRole, fieldText, type CardType, type CardWithStats, type FieldScript, type PackWithType } from "./heuresis";
import { type StudyTemplate } from "./study";

export type AttemptVerdict = "exact" | "close" | "different";
export type DiffSegment = { kind: "same" | "missing" | "extra"; text: string };
export type AttemptComparison = { verdict: AttemptVerdict; segments: DiffSegment[] };

const HAN = /\p{Script=Han}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const PINYIN_TONE_MARKS = /[āēīōūǖǎěǐǒǔǚ]/;
const DIFF_LIMIT = 400;

export function scriptOf(field: { script?: FieldScript } | null, text: string): FieldScript {
  if (field?.script) return field.script;
  if (HAN.test(text)) return "han";
  if (CYRILLIC.test(text)) return "cyrl";
  return "latn";
}

export function speechLanguage(text: string, pack: PackWithType) {
  if (HAN.test(text)) return "zh-CN";
  if (CYRILLIC.test(text)) return "ru-RU";
  const name = `${pack.title} ${pack.cardType?.name ?? ""}`.toLocaleLowerCase();
  if (/german|deutsch/.test(name)) return "de-DE";
  if (/french|français|francais/.test(name)) return "fr-FR";
  if (/italian|italiano/.test(name)) return "it-IT";
  if (/spanish|español|espanol/.test(name)) return "es-ES";
  return "en-GB";
}

export function dictationPromptText(card: CardWithStats | null, type: CardType | null, template: StudyTemplate | null) {
  if (!card) return "";
  for (const key of template?.front ?? []) {
    const value = fieldText(card.data, key);
    if (value) return value;
  }
  const term = fieldByRole(type, "term") ?? type?.field_schema[0] ?? null;
  return fieldText(card.data, term?.key);
}

export function dictationExpected(card: CardWithStats | null, type: CardType | null, template: StudyTemplate | null) {
  if (!card) return null;
  for (const key of template?.back ?? []) {
    const value = fieldText(card.data, key);
    if (!value) continue;
    const field = type?.field_schema.find((item) => item.key === key) ?? null;
    return { key, label: field?.label ?? key, text: value, script: scriptOf(field, value) };
  }
  return null;
}

function normalise(value: string, script: FieldScript, lenient: boolean) {
  let next = value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  next = next.replace(/^[\s"'“”«»(\[]+/, "").replace(/[\s"'“”«»)\].,;:!?。，、；：！？]+$/, "");
  if (script === "han") next = next.replace(/\s+/g, "");
  if (!lenient) return next;
  if (script === "cyrl") {
    next = next.replace(/[̀́]/g, "").replace(/ё/g, "е");
  }
  if (script === "latn") {
    const toneMarks = PINYIN_TONE_MARKS.test(next);
    const toneDigits = /[a-z][1-5]/.test(next);
    if (toneMarks) next = next.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (toneDigits) next = next.replace(/([a-z])[1-5]/g, "$1");
    if (toneMarks || toneDigits) next = next.replace(/['’]/g, "").replace(/\s+/g, "");
  }
  return next;
}

export function diffCharacters(expected: string, actual: string): DiffSegment[] {
  const a = Array.from(expected);
  const b = Array.from(actual);
  if (a.length > DIFF_LIMIT || b.length > DIFF_LIMIT) {
    return [{ kind: "missing", text: expected }, { kind: "extra", text: actual }];
  }

  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (kind: DiffSegment["kind"], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("same", a[i]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push("missing", a[i]); i += 1; }
    else { push("extra", b[j]); j += 1; }
  }
  while (i < a.length) { push("missing", a[i]); i += 1; }
  while (j < b.length) { push("extra", b[j]); j += 1; }
  return segments;
}

export function compareAttempt(expected: string, actual: string, script: FieldScript): AttemptComparison {
  const strictExpected = normalise(expected, script, false);
  if (strictExpected && strictExpected === normalise(actual, script, false)) {
    return { verdict: "exact", segments: [] };
  }
  const lenientExpected = normalise(expected, script, true);
  const verdict: AttemptVerdict = lenientExpected && lenientExpected === normalise(actual, script, true)
    ? "close"
    : "different";
  return { verdict, segments: diffCharacters(expected.normalize("NFC").trim(), actual.normalize("NFC").trim()) };
}

let voicesReady: Promise<void> | null = null;

function speech() {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function whenVoicesReady() {
  const synth = speech();
  if (!synth) return Promise.resolve();
  if (voicesReady) return voicesReady;
  voicesReady = new Promise<void>((resolve) => {
    if (synth.getVoices().length) { resolve(); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve();
    };
    synth.addEventListener("voiceschanged", finish);
    window.setTimeout(finish, 1500);
  });
  return voicesReady;
}

function pickVoice(synth: SpeechSynthesis, lang: string) {
  const voices = synth.getVoices();
  const wanted = lang.toLocaleLowerCase();
  return voices.find((voice) => voice.lang?.toLocaleLowerCase() === wanted)
    ?? voices.find((voice) => voice.lang?.toLocaleLowerCase().startsWith(wanted.slice(0, 2)))
    ?? null;
}

export function cancelDictationPrompt() {
  speech()?.cancel();
}

export async function playDictationPrompt(text: string, pack: PackWithType, rate = 1) {
  if (!text) throw new Error("This card has no text for the audio prompt.");
  const synth = speech();
  if (!synth) throw new Error("Text-to-speech is not available in this window.");
  await whenVoicesReady();
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLanguage(text, pack);
  utterance.rate = rate;
  const voice = pickVoice(synth, utterance.lang);
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export async function recordDictationAttempt(input: {
  cardId: string;
  packId: string;
  sessionId: string | null;
  templateId: string | null;
  expected: string;
  attempt: string;
  verdict: AttemptVerdict;
}) {
  if (!supabase) return;
  const { error } = await supabase.from("heuresis_dictation_attempts").insert({
    card_id: input.cardId,
    pack_id: input.packId,
    session_id: input.sessionId,
    template_id: input.templateId,
    expected: input.expected,
    attempt: input.attempt,
    verdict: input.verdict,
  });
  if (error) throw error;
}
