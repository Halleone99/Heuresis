/**
 * Language identity shared by the Notebook (subjects), Study (collections),
 * Capture and Progress. Subjects and collections are named freely ("Chinese",
 * "中文", "Mandarin HSK", "Deutsch B1"), so routing a note to a flashcard topic
 * must compare languages, not exact strings — and must never quietly fall back
 * to a topic in another language.
 *
 * Self-contained on purpose (no imports): scripts/check-languages.mjs runs it.
 */
export type LanguageKey = "zh" | "de" | "ru" | "en" | "fr" | "es" | "it" | "ja" | "ko";

type LanguageInfo = { name: string; glyph: string; aliases: string[] };

export const LANGUAGES: Record<LanguageKey, LanguageInfo> = {
  zh: { name: "Chinese", glyph: "中", aliases: ["chinese", "mandarin", "putonghua", "hanyu", "chinois", "chinesisch", "китайский", "中文", "汉语", "漢語", "普通话", "普通話", "华语", "華語"] },
  de: { name: "German", glyph: "Ä", aliases: ["german", "deutsch", "allemand", "немецкий", "德语", "德語"] },
  ru: { name: "Russian", glyph: "Я", aliases: ["russian", "russisch", "russe", "русский", "русский язык", "俄语", "俄語"] },
  en: { name: "English", glyph: "A", aliases: ["english", "englisch", "anglais", "английский", "英语", "英語"] },
  fr: { name: "French", glyph: "É", aliases: ["french", "français", "francais", "französisch", "французский", "法语", "法語"] },
  es: { name: "Spanish", glyph: "Ñ", aliases: ["spanish", "español", "espanol", "spanisch", "espagnol", "испанский"] },
  it: { name: "Italian", glyph: "È", aliases: ["italian", "italiano", "italienisch", "italien", "итальянский"] },
  ja: { name: "Japanese", glyph: "あ", aliases: ["japanese", "日本語", "nihongo", "japanisch", "japonais", "японский"] },
  ko: { name: "Korean", glyph: "한", aliases: ["korean", "한국어", "koreanisch", "coréen", "корейский"] },
};

const KEYS = Object.keys(LANGUAGES) as LanguageKey[];

function fold(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().trim();
}

/** "Chinese", "中文 · HSK 2", "Deutsch (B1)" → a language; unknown names → null. */
export function languageFromName(name: string | null | undefined): LanguageKey | null {
  const value = fold(name ?? "");
  if (!value) return null;
  // Latin aliases must match whole words ("German" must not match "Germanic studies"
  // only by accident; "Russian B1" still matches). CJK aliases match as substrings.
  const words = new Set(value.split(/[^\p{L}\p{M}]+/u).filter(Boolean));
  for (const key of KEYS) {
    for (const alias of LANGUAGES[key].aliases) {
      const folded = fold(alias);
      if (/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(folded)
        ? value.includes(folded)
        : folded.includes(" ") ? value.includes(folded) : words.has(folded)) return key;
    }
  }
  return null;
}

/** A Study collection: its title first, then the glyph it shows in the library. */
export function languageFromCollection(collection: { title?: string | null; glyph?: string | null }): LanguageKey | null {
  const byName = languageFromName(collection.title);
  if (byName) return byName;
  const glyph = (collection.glyph ?? "").trim();
  if (!glyph) return null;
  return KEYS.find((key) => LANGUAGES[key].glyph === glyph) ?? languageFromScript(glyph);
}

/**
 * Script evidence only where it is unambiguous for this app: Hanzi without kana
 * is Chinese, kana is Japanese, Hangul is Korean, Cyrillic is Russian.
 * Latin text says nothing about German versus English, so it returns null.
 */
export function languageFromScript(text: string | null | undefined): LanguageKey | null {
  const value = text ?? "";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return "ja";
  if (/\p{Script=Hangul}/u.test(value)) return "ko";
  if (/\p{Script=Han}/u.test(value)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(value)) return "ru";
  return null;
}

export function languageName(key: LanguageKey | null): string | null {
  return key ? LANGUAGES[key].name : null;
}

export type DestinationChoice<P> = {
  /** The pack to preselect, or null when the user has to choose deliberately. */
  pack: P | null;
  /** Language of the note, when it could be determined. */
  language: LanguageKey | null;
  /** Packs whose collection is in the note's language. */
  matching: P[];
};

/**
 * Choose where a flashcard made from a note should go by default.
 * Same-language collections win (the remembered topic only if it is one of them).
 * With several collections and none in the note's language, nothing is preselected:
 * filing a Russian note in a Chinese topic is worse than asking.
 */
export function chooseFlashcardDestination<P extends { id: string; collection_id: string }, C extends { id: string; title: string; glyph?: string | null }>(args: {
  subjectName: string | null | undefined;
  text: string;
  packs: P[];
  collections: C[];
  rememberedPackId?: string | null;
}): DestinationChoice<P> {
  const { packs, collections } = args;
  const subject = (args.subjectName ?? "").trim().toLocaleLowerCase();
  const language = languageFromName(args.subjectName) ?? languageFromScript(args.text);
  const sameLanguage = new Set(collections.filter((collection) =>
    (subject && collection.title.trim().toLocaleLowerCase() === subject)
    || (language !== null && languageFromCollection(collection) === language)).map((collection) => collection.id));
  const matching = packs.filter((pack) => sameLanguage.has(pack.collection_id));
  const remembered = packs.find((pack) => pack.id === args.rememberedPackId) ?? null;
  if (matching.length) {
    return { language, matching, pack: remembered && sameLanguage.has(remembered.collection_id) ? remembered : matching[0] };
  }
  // A known source language must never be silently routed into a different
  // language, even when there is only one available collection.
  if (language !== null) return { language, matching, pack: null };
  const usedCollections = new Set(packs.map((pack) => pack.collection_id));
  if (usedCollections.size <= 1) return { language, matching, pack: remembered ?? packs[0] ?? null };
  return { language, matching, pack: null };
}

/** Colour family per language (tokens --c-* exist for light and dark in every palette). */
const LANGUAGE_TONE: Record<LanguageKey, string> = {
  zh: "cinnabar", de: "amber", ru: "indigo", en: "sage", fr: "violet", es: "burgundy", it: "slate", ja: "burgundy", ko: "violet",
};

export function languageTone(key: LanguageKey | null): string | null {
  return key ? LANGUAGE_TONE[key] : null;
}
