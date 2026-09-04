export type CosmosMode = "review" | "sort";
export type CosmosSource = "all" | "new" | "favourites" | "interesting" | "again" | "unsorted";
export type CosmosOrder = "pack" | "random";

export type CosmosLaunch = {
  mode: CosmosMode;
  packId: string;
  templateId?: string | null;
  source?: CosmosSource;
  order?: CosmosOrder;
  count?: number | "all";
  tagId?: string;
  query?: string;
};

function buildParams(options: CosmosLaunch) {
  const params = new URLSearchParams({
    cosmos: "1",
    mode: options.mode,
    pack: options.packId,
    source: options.source ?? (options.mode === "sort" ? "unsorted" : "all"),
    order: options.order ?? "pack",
    count: String(options.count ?? "all"),
  });
  if (options.templateId) params.set("template", options.templateId);
  if (options.tagId) params.set("tag", options.tagId);
  if (options.query?.trim()) params.set("q", options.query.trim());
  return params;
}

export async function openCosmosWindow(options: CosmosLaunch) {
  const params = buildParams(options);
  const title = `${options.mode === "sort" ? "Sort" : "Flashcards"} · Heuresis`;

  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `cosmos-${options.mode}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const popup = new WebviewWindow(label, {
      url: `index.html?${params.toString()}`,
      title,
      width: 1540,
      height: 940,
      minWidth: 1080,
      minHeight: 700,
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

  const popup = window.open(`/?${params.toString()}`, "_blank", "popup,width=1540,height=940,resizable=yes,scrollbars=yes");
  if (!popup) throw new Error("The Heuresis popup was blocked.");
}
