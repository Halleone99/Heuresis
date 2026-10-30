import { isAndroidRuntime, openInCurrentApp } from "./platform";

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
  related?: boolean;
};

const SELECTION_PREFIX = "heuresis.review.selection:";

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
  if (isAndroidRuntime()) {
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
  if (!popup) throw new Error("The Heuresis popup was blocked.");
}
