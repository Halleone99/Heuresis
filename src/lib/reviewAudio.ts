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

export function speakReviewText(text: string, language: string): boolean {
  if (!text.trim() || typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.trim());
  utterance.lang = language;
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopReviewAudio() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
