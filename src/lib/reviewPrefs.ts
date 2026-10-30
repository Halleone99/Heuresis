/**
 * Remembered Review choices (device-local, like other view preferences).
 *  - The answering method is one preference for every session, changeable during Review.
 *  - Adjust settings are remembered per topic. One-click Review always starts a
 *    recommended session, using the remembered directions and session size.
 */
export type ReviewMethod = "think" | "say" | "type" | "handwrite" | "hear";
export type ReviewSourceChoice = "recommended" | "all" | "new" | "favourites" | "interesting" | "again";
export type ReviewPrefs = {
  directionMode: "auto" | "both" | "one";
  pairKey: string | null;
  templateId: string | null;
  source: ReviewSourceChoice;
  size: number;
  order: "pack" | "random" | "weakest" | "oldest";
};

export const DEFAULT_SESSION_SIZE = 20;
export const MORE_SIZE = 10;
export const DEFAULT_REVIEW_PREFS: ReviewPrefs = { directionMode: "auto", pairKey: null, templateId: null, source: "recommended", size: DEFAULT_SESSION_SIZE, order: "weakest" };

export const METHOD_LABEL: Record<ReviewMethod, string> = {
  think: "In my head",
  say: "Saying it aloud",
  type: "Typing it",
  handwrite: "Writing it by hand",
  hear: "Listening first",
};

const METHOD_KEY = "heuresis.review.method.v1";
const prefsKey = (packId: string) => `heuresis.review.prefs.v1:${packId}`;
const METHODS: ReviewMethod[] = ["think", "say", "type", "handwrite", "hear"];
const SOURCES: ReviewSourceChoice[] = ["recommended", "all", "new", "favourites", "interesting", "again"];

export function readReviewMethod(): ReviewMethod {
  try {
    const value = localStorage.getItem(METHOD_KEY);
    return METHODS.includes(value as ReviewMethod) ? value as ReviewMethod : "think";
  } catch { return "think"; }
}

export function writeReviewMethod(method: ReviewMethod) {
  try { localStorage.setItem(METHOD_KEY, method); } catch { /* preference only */ }
}

export function readReviewPrefs(packId: string): ReviewPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey(packId)) ?? "null") as Partial<ReviewPrefs> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_REVIEW_PREFS };
    return {
      directionMode: raw.directionMode === "both" || raw.directionMode === "one" ? raw.directionMode : "auto",
      pairKey: typeof raw.pairKey === "string" ? raw.pairKey : null,
      templateId: typeof raw.templateId === "string" ? raw.templateId : null,
      source: SOURCES.includes(raw.source as ReviewSourceChoice) ? raw.source as ReviewSourceChoice : "recommended",
      size: Number.isFinite(raw.size) && Number(raw.size) > 0 ? Math.min(500, Math.floor(Number(raw.size))) : DEFAULT_SESSION_SIZE,
      order: raw.order === "random" || raw.order === "weakest" || raw.order === "oldest" ? raw.order : "weakest",
    };
  } catch { return { ...DEFAULT_REVIEW_PREFS }; }
}

export function writeReviewPrefs(packId: string, prefs: ReviewPrefs) {
  try { localStorage.setItem(prefsKey(packId), JSON.stringify(prefs)); } catch { /* preference only */ }
}

/** Template ids for the remembered direction choice, or [] for "let Heuresis choose". */
export function rememberedTemplateIds(prefs: ReviewPrefs, available: Array<{ id: string }>, pairs: Array<{ key: string; ids: [string, string] }>) {
  if (prefs.directionMode === "one" && prefs.templateId && available.some((item) => item.id === prefs.templateId)) return [prefs.templateId];
  if (prefs.directionMode === "both" && prefs.pairKey) {
    const pair = pairs.find((item) => item.key === prefs.pairKey);
    if (pair) return [...pair.ids];
  }
  return [];
}
