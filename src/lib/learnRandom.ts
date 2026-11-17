import type { Tile } from "./learnExercises";

/*
 * Deterministic randomness shared by every kind of exercise: the same seed gives the same
 * round, so a round rebuilt from its seed (or on another device) is identical.
 */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed: string) {
  let a = hash(seed) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A shuffle that never leaves the tiles already in the right order. */
export function scramble<T>(items: T[], random: () => number, same: (a: T, b: T) => boolean): T[] {
  if (items.length < 2) return [...items];
  for (let tries = 0; tries < 6; tries += 1) {
    const mixed = shuffle(items, random);
    if (mixed.some((item, index) => !same(item, items[index]))) return mixed;
  }
  return [...items.slice(1), items[0]];
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const k = key(item); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Tiles in a shuffled order that is never already the solution. `texts` starts with the right order. */
export function tiles(texts: string[], random: () => number): Tile[] {
  const made = texts.map((text, index) => ({ id: `t${index}`, text }));
  return scramble(made, random, (a, b) => a.text === b.text);
}
