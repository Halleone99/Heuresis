import { openInCurrentApp, prefersSingleWindowNavigation } from "./platform";

export type CosmosMode = "review" | "sort";
export type CosmosSource = "recommended" | "all" | "new" | "favourites" | "interesting" | "again" | "unsorted";
export type CosmosOrder = "pack" | "random" | "weakest" | "oldest";

export type CosmosLaunch = {
  mode: CosmosMode;
  packId: string;
  templateId?: string | null;
  templateIds?: string[];
  source?: CosmosSource;
  order?: CosmosOrder;
  count?: number | "all";
  tagId?: string;
  tagIds?: string[];
  reviewFlags?: string[];
  includeMastered?: boolean;
  query?: string;
  /** Exact card selection for filtered and targeted reviews. */
  cardIds?: string[];
  /** Guided multi-topic Review, independent of the daily new-card quota. */
  reviewRouteToken?: string;
  related?: boolean;
};

const SELECTION_PREFIX = "heuresis.review.selection:";
const ROUTE_PREFIX = "heuresis.review.route:";
const SELECTION_TTL_MS = 24 * 60 * 60 * 1000;

export type ReviewRouteEntry = { packId: string; cardIds: string[] };

/** Keep the exact list of due cards for each topic in a Review-all session. */
export function createReviewRoute(entries: ReviewRouteEntry[]): string {
  const route = entries.map(({ packId, cardIds }) => ({
    packId,
    cardIds: Array.from(new Set(cardIds.filter(Boolean))),
  })).filter((entry) => entry.packId && entry.cardIds.length);
  if (!route.length) throw new Error("No cards are available for Review.");
  const token = crypto.randomUUID();
  try {
    localStorage.setItem(ROUTE_PREFIX + token, JSON.stringify({ route, createdAt: Date.now() }));
  } catch {
    throw new Error("This device could not retain the Review-all session. Check available storage and retry.");
  }
  return token;
}

export function readReviewRoute(token: string): ReviewRouteEntry[] {
  try {
    const raw = localStorage.getItem(ROUTE_PREFIX + token);
    const saved = JSON.parse(raw ?? "null") as { route: ReviewRouteEntry[]; createdAt: number } | null;
    if (!token || !saved || !Array.isArray(saved.route) || !saved.route.length
      || saved.route.some((entry) => !entry || typeof entry.packId !== "string" || !entry.packId
        || !Array.isArray(entry.cardIds) || !entry.cardIds.length
        || entry.cardIds.some((id) => typeof id !== "string" || !id))
      || !Number.isFinite(saved.createdAt) || Date.now() - saved.createdAt > SELECTION_TTL_MS) {
      throw new Error("The Review-all session has expired.");
    }
    return saved.route;
  } catch {
    throw new Error("Could not continue Review all. Return to the Review Centre and start again.");
  }
}

/** The same popup advances to the next topic; each topic retains its own session. */
export function nextReviewRouteParams(token: string, currentPackId: string): URLSearchParams | null {
  const route = readReviewRoute(token);
  const index = route.findIndex((entry) => entry.packId === currentPackId);
  if (index < 0) throw new Error("This topic is no longer part of the Review-all session.");
  const next = route[index + 1];
  return next ? buildParams({
    mode: "review", packId: next.packId, source: "all", order: "weakest",
    count: "all", cardIds: next.cardIds, reviewRouteToken: token,
  }) : null;
}

/** Selected cards travel safely between the main window and the Review webview. */
export function readReviewSelection(packId: string, token: string): string[] {
  if (!token) return [];
  try {
    const raw = localStorage.getItem(SELECTION_PREFIX + token);
    if (!raw) throw new Error("The selection was not found.");
    const selection = JSON.parse(raw) as { packId: string; cardIds: string[]; createdAt: number };
    if (selection.packId !== packId || !Array.isArray(selection.cardIds)
      || selection.cardIds.some((value) => typeof value !== "string")
      || !Number.isFinite(selection.createdAt) || Date.now() - selection.createdAt > 24 * 60 * 60 * 1000) {
      throw new Error("The selection is no longer valid.");
    }
    return Array.from(new Set(selection.cardIds));
  } catch {
    throw new Error("Could not load the selected cards. Return to the topic and start Review again.");
  }
}

function buildParams(options: CosmosLaunch) {
  const related = Boolean(options.related && options.mode === "review");
  const params = new URLSearchParams({
    cosmos: "1",
    mode: options.mode,
    pack: options.packId,
    source: related ? "all" : options.source ?? (options.mode === "sort" ? "unsorted" : "all"),
    order: options.order ?? "pack",
    count: String(options.count ?? "all"),
  });
  if (related) params.set("related", "1");
  if (options.reviewRouteToken && options.mode === "review") params.set("route", options.reviewRouteToken);
  const templateIds = (options.templateIds ?? []).filter(Boolean);
  if (templateIds.length) params.set("templates", templateIds.join(","));
  else if (options.templateId) params.set("template", options.templateId);
  const tagIds = Array.from(new Set([...(options.tagIds ?? []), ...(options.tagId ? [options.tagId] : [])].filter(Boolean)));
  tagIds.forEach((tagId) => params.append("tag", tagId));
  (options.reviewFlags ?? []).forEach((flag) => params.append("flag", flag));
  if (options.includeMastered) params.set("mastered", "1");
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.cardIds) {
    const ids = Array.from(new Set(options.cardIds.filter(Boolean)));
    if (!ids.length) throw new Error("There are no cards to review in this selection.");
    const token = crypto.randomUUID();
    try {
      localStorage.setItem(SELECTION_PREFIX + token, JSON.stringify({ packId: options.packId, cardIds: ids, createdAt: Date.now() }));
    } catch {
      throw new Error("This device could not retain the selected cards. Check available storage and retry.");
    }
    params.set("selection", token);
  }
  return params;
}

export async function openCosmosWindow(options: CosmosLaunch) {
  const params = buildParams(options);
  const title = `${options.related ? "Related" : options.mode === "sort" ? "Sort" : "Flashcards"} · Heuresis`;

  // Android uses the main app webview for study/review so sessions and auth remain
  // in the same persisted client rather than relying on desktop popup windows.
  if (prefersSingleWindowNavigation()) {
    openInCurrentApp(params);
    return;
  }

  // Fit the Review popup within the usable desktop area, including the taskbar.
  // Match Tauri's logical window dimensions to browser screen CSS pixels.
  const width = Math.max(760, Math.min(1540, (window.screen.availWidth || 1540) - 28));
  const height = Math.max(540, Math.min(940, (window.screen.availHeight || 940) - 40));

  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `cosmos-${options.related ? "related" : options.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const popup = new WebviewWindow(label, {
      url: `index.html?${params.toString()}`,
      title,
      width,
      height,
      minWidth: Math.min(1080, width),
      minHeight: Math.min(700, height),
      center: true,
      focus: true,
      resizable: true,
      decorations: true,
    });

    await new Promise<void>((resolve, reject) => {
      void popup.once("tauri://created", () => resolve());
      void popup.once("tauri://error", (event) => reject(new Error(`Could not open Heuresis popup: ${String(event.payload)}`)));
    });
    return;
  }

  const popup = window.open(`/?${params.toString()}`, "_blank", `popup,width=${width},height=${height},resizable=yes,scrollbars=yes`);
  if (!popup) {
    params.set("inTab", "1");
    openInCurrentApp(params);
    return;
  }
}
