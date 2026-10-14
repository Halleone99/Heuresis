import { isAndroidRuntime, openInCurrentApp } from "./platform";

export type CosmosMode = "review" | "sort";
export type CosmosSource = "all" | "new" | "favourites" | "interesting" | "again" | "unsorted";
export type CosmosOrder = "pack" | "random";

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
  query?: string;
  related?: boolean;
};

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
  if (options.query?.trim()) params.set("q", options.query.trim());
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
