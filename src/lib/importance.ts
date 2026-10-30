/**
 * Intended use of knowledge, shown as three levels. The stored interest_rank keeps its
 * 1–5 range: existing values are never rewritten. New choices store 5 / 3 / 1, and
 * older 4s and 2s are shown as Core and Peripheral.
 */
export type Importance = "core" | "useful" | "peripheral";

export const IMPORTANCE_ORDER: readonly Importance[] = ["core", "useful", "peripheral"];

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  core: "Core",
  useful: "Active",
  peripheral: "Passive",
};

export const IMPORTANCE_HINT: Record<Importance, string> = {
  core: "Essential knowledge to recall effortlessly",
  useful: "Knowledge to learn and use actively",
  peripheral: "Knowledge to recognise without necessarily using",
};

/** The value written when a level is chosen. */
export const IMPORTANCE_RANK: Record<Importance, number> = { core: 5, useful: 3, peripheral: 1 };

export function importanceOf(rank: number | null | undefined): Importance | null {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) return null;
  if (rank >= 4) return "core";
  if (rank === 3) return "useful";
  return "peripheral";
}

/** Keyboard digits keep working: 1–2 Passive, 3 Active, 4–5 Core. */
export function importanceForDigit(digit: number): Importance | null {
  if (digit === 1 || digit === 2) return "peripheral";
  if (digit === 3) return "useful";
  if (digit === 4 || digit === 5) return "core";
  return null;
}

/** Ranks that belong to a level, for filtering stored 1–5 values. */
export function ranksFor(level: Importance): number[] {
  return level === "core" ? [4, 5] : level === "useful" ? [3] : [1, 2];
}
