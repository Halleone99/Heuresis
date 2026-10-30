export function isAndroidRuntime() {
  return /Android/i.test(navigator.userAgent);
}

/**
 * Marks the document as the Android app (MagicPad APK) before the first render, so the
 * tablet layer in android-tablet.css applies there and nowhere else. On Windows and in
 * desktop browsers this does nothing: no attribute, no listener.
 */
export function markAndroidRuntime() {
  if (!isAndroidRuntime()) return;
  document.documentElement.dataset.platform = "android";
  // Leaving Review goes Back to the page it was opened from. If the WebView restores that
  // page from its back/forward cache instead of reloading it, refresh Study's counts.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.dispatchEvent(new Event("heuresis:study-changed"));
  });
}

export function openInCurrentApp(params: URLSearchParams) {
  const next = `index.html?${params.toString()}`;
  window.location.assign(next);
}

export function returnToHeuresisApp() {
  // Review navigates the only Android WebView, so going Back alone may reload
  // Heuresis at its default landing page instead of restoring the open topic.
  const packId = new URLSearchParams(window.location.search).get("pack");
  if (packId) {
    window.location.replace(`index.html?resumePack=${encodeURIComponent(packId)}`);
    return;
  }
  if (window.history.length > 1) window.history.back();
  else window.location.replace("index.html");
}
