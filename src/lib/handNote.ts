/** Compact, portable vector handwriting inside an ordinary Heuresis note body. */
export type HandStroke = { d: string; color: string };
export const HAND_NOTE_SIZE = { width: 900, height: 700 } as const;
export const HAND_NOTE_COLOURS = ["#202938", "#2563eb", "#c2410c"] as const;
export const HAND_NOTE_PREFIX = "::handnote:v1:";

export function encodeHandNote(strokes: HandStroke[]): string {
  return HAND_NOTE_PREFIX + btoa(JSON.stringify({ version: 1, strokes }));
}

export function decodeHandNote(encoded: string): HandStroke[] {
  try {
    const data = JSON.parse(atob(encoded)) as { version?: number; strokes?: unknown };
    if (data.version !== 1 || !Array.isArray(data.strokes) || data.strokes.length > 1000) return [];
    if (!data.strokes.every((stroke) => {
      const row = stroke as HandStroke;
      return typeof row?.d === "string" && row.d.length <= 50000 &&
        /^[ML0-9 .-]+$/.test(row.d) && HAND_NOTE_COLOURS.includes(row.color as typeof HAND_NOTE_COLOURS[number]);
    })) return [];
    return data.strokes as HandStroke[];
  } catch { return []; }
}
