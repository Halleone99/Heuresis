/** Native Android shell, not an ordinary Android browser. */
export function isAndroidRuntime() {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return false;
  // Tauri exposes its bridge. The separate Android WebView wrapper identifies itself
  // with the "wv" user-agent token; Chrome/Firefox on Android do not.
  return (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)
    || /\bwv\b/i.test(navigator.userAgent);
}

/** Phone-sized, touch-based browsers should navigate within the current tab.
 * Popups are commonly blocked there, and closing a browser tab cannot be guaranteed.
 */
export function prefersSingleWindowNavigation() {
  if (isAndroidRuntime()) return true;
  return typeof window !== "undefined"
    && Boolean(window.matchMedia?.("(pointer: coarse) and (max-width: 900px)").matches);
}

function homePath() {
  return isAndroidRuntime() ? "index.html" : "/";
}

/** Mark the native Android shell before first paint.
 * Touch-responsive browser styles still come from tablet.css, independently.
 */
export function markAndroidRuntime() {
  if (!isAndroidRuntime()) return;
  document.documentElement.dataset.platform = "android";
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.dispatchEvent(new Event("heuresis:study-changed"));
  });
}

export function openInCurrentApp(params: URLSearchParams) {
  window.location.assign(`${homePath()}?${params.toString()}`);
}

export function returnToHeuresisApp() {
  const packId = new URLSearchParams(window.location.search).get("pack");
  if (packId) {
    window.location.replace(`${homePath()}?resumePack=${encodeURIComponent(packId)}`);
    return;
  }
  if (window.history.length > 1) window.history.back();
  else window.location.replace(homePath());
}
