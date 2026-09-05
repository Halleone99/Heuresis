export type CaptureLaunch = {
  packId?: string | null;
  collectionId?: string | null;
};

function buildParams(options: CaptureLaunch) {
  const params = new URLSearchParams({ capture: "1" });
  if (options.packId) params.set("pack", options.packId);
  if (options.collectionId) params.set("collection", options.collectionId);
  return params;
}

export async function openCaptureWindow(options: CaptureLaunch = {}) {
  const params = buildParams(options);

  if ("__TAURI_INTERNALS__" in window) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const label = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const popup = new WebviewWindow(label, {
      url: `index.html?${params.toString()}`,
      title: "Capture · Heuresis",
      width: 610,
      height: 790,
      minWidth: 440,
      minHeight: 560,
      center: true,
      focus: true,
      resizable: true,
      decorations: true,
      alwaysOnTop: true,
    });

    await new Promise<void>((resolve, reject) => {
      void popup.once("tauri://created", () => resolve());
      void popup.once("tauri://error", (event) => reject(new Error(`Could not open Capture: ${String(event.payload)}`)));
    });
    return;
  }

  const popup = window.open(
    `/?${params.toString()}`,
    "heuresis-capture",
    "popup,width=610,height=790,resizable=yes,scrollbars=yes",
  );
  if (!popup) throw new Error("The Capture popup was blocked.");
  popup.focus();
}
