import { isAndroidRuntime } from "../platform";

/**
 * Handing an exported PDF to the person, per runtime:
 *  - browser and Windows app (WebView2): a normal download (Windows: the Downloads folder);
 *  - Android app: the WebView has no download handler, so the APK's MainActivity
 *    exposes HeuresisAndroidFiles.savePdf (see .github/workflows/tauri-android.yml),
 *    which writes to Downloads/Heuresis through MediaStore.
 */
type AndroidFiles = { savePdf?: (name: string, base64: string) => string };

export function safeFileName(title: string, extension = "pdf") {
  const base = title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "Heuresis article";
  return `${base}.${extension}`;
}

function toBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not prepare the file."));
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  });
}

export type SaveOutcome = { where: string };

export async function savePdfFile(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
  const app = "__TAURI_INTERNALS__" in window;
  // A browser on an Android phone downloads normally; only the Android app needs the bridge.
  if (app && isAndroidRuntime()) {
    const bridge = (window as unknown as { HeuresisAndroidFiles?: AndroidFiles }).HeuresisAndroidFiles;
    if (!bridge?.savePdf) throw new Error("This copy of the Android app cannot save files yet. Install the latest Heuresis APK, or export from the desktop app.");
    const result = bridge.savePdf(fileName, await toBase64(bytes));
    if (!result || result.startsWith("error:")) throw new Error(`The PDF could not be saved on this tablet${result ? `: ${result.slice(6)}` : "."}`);
    return { where: result };
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return { where: app ? "your Downloads folder" : "your browser's downloads" };
}
