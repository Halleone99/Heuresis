/**
 * Older imported pinyin sometimes contains SPACING tone symbols after a vowel:
 * "Haˇo" (U+02C7) rather than "Hǎo" (U+01CE).
 *
 * Make it readable in memory and normalise it again at save boundaries.
 * Never strip accents, change Hanzi, or guess that an ordinary number is a tone.
 */
const spacingMarks: Record<string, string> = {
  "ˉ": "\u0304", // macron
  "ˊ": "\u0301", // acute
  "ˇ": "\u030c", // caron
  "ˋ": "\u0300", // grave
};

const spacingTonePattern = /([aeiouüAEIOUÜ])([ˉˊˇˋ])/gu;
const uncomposedTonePattern = /[ˉˊˇˋ\u0300-\u036f]/u;

export function repairPinyinToneMarks(value: string): string {
  if (!uncomposedTonePattern.test(value)) return value;
  const repaired = value.replace(spacingTonePattern, (_, vowel: string, tone: string) =>
    (vowel + spacingMarks[tone]).normalize("NFC"));
  // Also handles legitimate combining diacritics such as i + U+030C.
  return repaired.normalize("NFC");
}
