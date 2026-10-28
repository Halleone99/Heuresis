/**
 * Side-by-side correction highlighting, with different levels of precision:
 * Hanzi: individual characters. German/Russian: words and punctuation.
 * Whitespace is preserved; no HTML injection or destructive rewrite of records.
 */
export type DifferencePart = { text: string; kind: "same" | "wrong" | "corrected" | "gap" };
export type MistakeDifference = { before: DifferencePart[]; after: DifferencePart[] };

function tokenize(value: string, characterLevel: boolean): string[] {
  return characterLevel ? Array.from(value) : value.match(/[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu) ?? [];
}

function refineSingleWord(before: DifferencePart[], after: DifferencePart[]): MistakeDifference {
  const removed = before.filter((part) => part.kind === "wrong");
  const added = after.filter((part) => part.kind === "corrected");
  if (removed.length !== 1 || added.length !== 1) return { before: condense(before), after: condense(after) };
  const oldWord = removed[0].text, newWord = added[0].text;
  if (!/^[\p{L}\p{M}]+$/u.test(oldWord) || !/^[\p{L}\p{M}]+$/u.test(newWord)) {
    return { before: condense(before), after: condense(after) };
  }
  const a = Array.from(oldWord), b = Array.from(newWord);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  while (suffix < Math.min(a.length, b.length) - prefix &&
    a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix += 1;
  if (prefix < 2 && suffix < 2) return { before: condense(before), after: condense(after) };
  const split = (value: string[], kind: DifferencePart["kind"]): DifferencePart[] => [
    ...(prefix ? [{ text: value.slice(0, prefix).join(""), kind: "same" as const }] : []),
    { text: value.slice(prefix, value.length - suffix).join(""), kind },
    ...(suffix ? [{ text: value.slice(value.length - suffix).join(""), kind: "same" as const }] : []),
  ].filter((part) => part.text);
  return {
    before: condense(before.flatMap((part) => part === removed[0] ? split(a, "wrong") : [part])),
    after: condense(after.flatMap((part) => part === added[0] ? split(b, "corrected") : [part])),
  };
}

function condense(parts: DifferencePart[]): DifferencePart[] {
  const combined: DifferencePart[] = [];
  for (const part of parts) {
    const prev = combined[combined.length - 1];
    if (prev?.kind === part.kind) prev.text += part.text;
    else combined.push({ ...part });
  }
  return combined;
}

export function mistakeDifference(original: string, corrected: string): MistakeDifference {
  if (!original || !corrected || original === corrected) {
    return {
      before: [{ text: original, kind: "same" }],
      after: [{ text: corrected, kind: "same" }],
    };
  }

  const characterLevel = /[\u3400-\u9fff]/u.test(original + corrected);
  const a = tokenize(original, characterLevel);
  const b = tokenize(corrected, characterLevel);
  // Short entries are typical; avoid quadratic processing on pasted paragraphs.
  if (a.length > 240 || b.length > 240) {
    return { before: [{ text: original, kind: "wrong" }], after: [{ text: corrected, kind: "corrected" }] };
  }

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const before: DifferencePart[] = [];
  const after: DifferencePart[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      before.push({ text: a[i], kind: "same" });
      after.push({ text: b[j], kind: "same" });
      i++; j++;
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) {
      before.push({ text: a[i++], kind: "wrong" });
    } else {
      const token = b[j++];
      if (token.trim() && before[before.length - 1]?.kind !== "wrong" &&
        before[before.length - 1]?.kind !== "gap") {
        before.push({ text: "‸", kind: "gap" });
      }
      after.push({ text: token, kind: "corrected" });
    }
  }

  return refineSingleWord(before, after);
}
