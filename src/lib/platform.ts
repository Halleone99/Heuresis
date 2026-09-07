export function isAndroidRuntime() {
  return /Android/i.test(navigator.userAgent);
}

export function openInCurrentApp(params: URLSearchParams) {
  const next = `index.html?${params.toString()}`;
  window.location.assign(next);
}

export function returnToHeuresisApp() {
  if (window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.assign("index.html");
}
