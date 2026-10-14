/**
 * Side-by-side correction highlighting, with different levels of precision:
 * Hanzi: individual characters. German/Russian: words and punctuation.
 * Whitespace is preserved; no HTML injection or destructive rewrite of records.
 */
export type DifferencePart = { text: string; kind: "same" | "wrong" | "corrected" };
export type MistakeDifference = { before: DifferencePart[]; after: DifferencePart[] };

function tokenize(value: string, characterLevel: boolean): string[] {
  return characterLevel ? Array.from(value) : value.match(/[\p{L}\p{M}\p{N}]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu) ?? [];
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
      after.push({ text: b[j++], kind: "corrected" });
    }
  }

  return { before: condense(before), after: condense(after) };
}
