/**
 * Choose text-to-speech language from the *actual spoken field*, not merely
 * the topic. In a German → English card, the German term and English gloss
 * must use different voices. Script detection takes precedence for Russian
 * and Chinese; Latin-script target terms use the topic's language.
 */
export type ReviewSpeechRole = "term" | "meaning" | "other";
export type SpokenLanguage = "en-GB" | "zh-CN" | "ru-RU" | "de-DE" | "fr-FR" | "it-IT" | "es-ES" | "pt-PT";

export function reviewSpeechLanguage(text: string, packTitle: string, cardTypeName = "", role: ReviewSpeechRole = "other"): SpokenLanguage {
  if (/\p{Script=Han}/u.test(text)) return "zh-CN";
  if (/\p{Script=Cyrillic}/u.test(text)) return "ru-RU";
  // The meaning field is the English gloss in the language vocabulary schemas.
  if (role === "meaning") return "en-GB";
  const topic = `${packTitle} ${cardTypeName}`.toLocaleLowerCase();
  if (/german|deutsch/.test(topic)) return "de-DE";
  if (/russian|русск/.test(topic)) return "ru-RU";
  if (/french|fran[çc]ais/.test(topic)) return "fr-FR";
  if (/italian|italiano/.test(topic)) return "it-IT";
  if (/spanish|espa[ñn]ol/.test(topic)) return "es-ES";
  if (/portuguese|português/.test(topic)) return "pt-PT";
  if (/chinese|mandarin|中文|汉语|漢語|hsk/.test(topic)) return "zh-CN";
  return "en-GB";
}

/** Prefer a non-reading prompt. Pinyin and stress annotations would spoil recognition. */
export function reviewSpokenPrompt(
  front: string[],
  data: Record<string, unknown>,
  readingKey?: string | null,
): { key: string; text: string } | null {
  for (const key of front) {
    if (key === readingKey) continue;
    const value = data[key];
    if (typeof value === "string" && value.trim()) return { key, text: value.trim() };
  }
  return null;
}


type AndroidSpeech = {
  isAvailable(locale: string): boolean;
  isReady(): boolean;
  speak(text: string, locale: string, rate: number, utteranceId: string): boolean;
  stop(): void;
  keepScreenOn(on: boolean): void;
};
declare global {
  interface Window {
    HeuresisAndroidSpeech?: AndroidSpeech;
    heuresisSpeechStarted?: (utteranceId: string) => void;
    heuresisSpeechFailed?: (utteranceId: string) => void;
  }
}

let currentAudioId = "";
let currentOnStart: (() => void) | undefined;
let sequence = 0;

/** Check the *requested language* before exposing Hear on the Android WebView. */
export function canSpeak(language: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.HeuresisAndroidSpeech) {
    try { return window.HeuresisAndroidSpeech.isAvailable(language); } catch { return false; }
  }
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** A successful queue request is not playback. onStarted runs only when speech actually begins. */
export function speakReviewText(text: string, language: string, onStarted?: () => void): boolean {
  if (!text.trim() || typeof window === "undefined") return false;
  stopReviewAudio();
  const utteranceId = `heuresis-${++sequence}`;
  currentAudioId = utteranceId;
  currentOnStart = onStarted;

  const native = window.HeuresisAndroidSpeech;
  if (native) {
    try {
      // Register before requesting speech: short utterances may start immediately.
      window.heuresisSpeechStarted = (id) => {
        if (id !== currentAudioId) return;
        const callback = currentOnStart;
        currentOnStart = undefined;
        callback?.();
      };
      window.heuresisSpeechFailed = (id) => {
        if (id === currentAudioId) { currentAudioId = ""; currentOnStart = undefined; }
      };
      if (!native.isAvailable(language) || !native.speak(text.trim(), language, 0.9, utteranceId)) {
        currentAudioId = ""; currentOnStart = undefined; return false;
      }
      return true;
    } catch {
      currentAudioId = ""; currentOnStart = undefined; return false;
    }
  }

  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  try {
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = language;
    utterance.rate = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const locale = language.toLowerCase();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === locale)
      ?? voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === locale.split("-")[0])
      ?? null;
    utterance.onstart = () => {
      if (currentAudioId !== utteranceId) return;
      const callback = currentOnStart; currentOnStart = undefined; callback?.();
    };
    utterance.onerror = () => { if (currentAudioId === utteranceId) currentAudioId = ""; };
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    currentAudioId = ""; currentOnStart = undefined; return false;
  }
}

export function stopReviewAudio() {
  currentAudioId = "";
  currentOnStart = undefined;
  if (typeof window === "undefined") return;
  try { window.HeuresisAndroidSpeech?.stop(); } catch { /* device may be stopping */ }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

const AUTO_PRONUNCIATION_KEY = "heuresis.language.autoplay.v1";
export function readAutoPronunciation(): boolean {
  try { return localStorage.getItem(AUTO_PRONUNCIATION_KEY) !== "off"; } catch { return true; }
}
export function writeAutoPronunciation(on: boolean): void {
  try { localStorage.setItem(AUTO_PRONUNCIATION_KEY, on ? "on" : "off"); } catch { /* device preference */ }
  if (!on) stopReviewAudio();
}
const TARGET_LOCALES: Record<string, string> = {
  en: "en-GB", de: "de-DE", ru: "ru-RU", zh: "zh-CN", fr: "fr-FR",
  es: "es-ES", it: "it-IT", ja: "ja-JP", ko: "ko-KR", pt: "pt-PT",
};
export function targetSpeechLocale(language: string | null | undefined): string | null {
  return language ? TARGET_LOCALES[language] ?? null : null;
}
/** Speak only actual source-language text, never a gloss, pinyin or a gapped prompt. */
export function learningFeedbackSpeech(
  card: { form: string; language: string | null; rule?: unknown; examples: { source: string }[] },
  exercise: { kind: string; solution: string; prompt: { text: string }; explain: string },
): { text: string; locale: string } | null {
  const locale = targetSpeechLocale(card.language);
  if (!locale || card.rule) return null;
  let text = card.form;
  if (exercise.kind === "build-sentence" || exercise.kind === "example-write") text = exercise.solution;
  else if (exercise.kind === "example-meaning") text = exercise.prompt.text;
  else if (exercise.kind === "cloze-choice" || exercise.kind === "cloze-type") {
    text = card.examples.find((example) => exercise.explain === example.source
      || exercise.explain.startsWith(example.source + " — "))?.source ?? card.form;
  }
  return text.trim() ? { text, locale } : null;
}
