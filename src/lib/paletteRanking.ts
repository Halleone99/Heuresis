/**
 * Ordering for the Ctrl+K palette, kept free of imports so it can be tested
 * directly (scripts/check-palette-ranking.mjs).
 *
 * Commands used to be listed above every note, so typing the title of a note
 * that happened to contain "note", "lesson" or "mistake" and pressing Enter ran
 * a command instead of opening the note. Now the group with the stronger match
 * comes first: a command whose name matches, or a note/topic whose title does.
 */
export type RankableCommand = { label: string; detail: string; keywords?: string };

/** Accent- and case-insensitive text for matching (pinyin "xiàkè" ≈ "xiake"). */
export function foldForSearch(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function commandScore(command: RankableCommand, words: string[]): number {
  if (!words.length) return 1;
  const label = foldForSearch(command.label);
  if (words.every((word) => label.includes(word))) return label.startsWith(words[0]) ? 50 : 40;
  const extra = foldForSearch([command.label, command.detail, command.keywords ?? ""].join(" "));
  return words.every((word) => extra.includes(word)) ? 5 : 0;
}

/** Note and topic results first only when one of them matches better than any command. */
export function resultsFirst(bestCommandScore: number, bestResultScore: number, hasQuery: boolean) {
  return hasQuery && bestResultScore > bestCommandScore;
}
