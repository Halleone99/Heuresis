import assert from "node:assert/strict";
import {
  isAndroidRuntime,
  prefersSingleWindowNavigation,
  markAndroidRuntime,
  openInCurrentApp,
  returnToHeuresisApp,
} from "../src/lib/platform.ts";

const androidChrome = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36";
const androidWebView = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AB12; wv) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36";
const iosSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0 Safari/537.36";

function environment(userAgent, { touch = false, native = false, search = "", historyLength = 1 } = {}) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent } });
  const next = { assigned: null, replaced: null };
  globalThis.window = {
    matchMedia: () => ({ matches: touch }),
    location: {
      search,
      assign: (path) => { next.assigned = path; },
      replace: (path) => { next.replaced = path; },
    },
    history: { length: historyLength, back: () => { next.back = true; } },
    addEventListener: () => {},
    ...(native ? { __TAURI_INTERNALS__: {} } : {}),
  };
  globalThis.document = { documentElement: { dataset: {} } };
  return next;
}

const chrome = environment(androidChrome, { touch: true });
assert.equal(isAndroidRuntime(), false, "Android Chrome is not the native app");
assert.equal(prefersSingleWindowNavigation(), true, "Phone browser should use one tab");
markAndroidRuntime();
assert.equal(document.documentElement.dataset.platform, undefined, "Web must not receive native Android CSS");
openInCurrentApp(new URLSearchParams({ cosmos: "1", pack: "abc" }));
assert.equal(chrome.assigned, "/?cosmos=1&pack=abc");
window.location.search = "?cosmos=1&pack=abc";
returnToHeuresisApp();
assert.equal(chrome.replaced, "/?resumePack=abc");

const webview = environment(androidWebView, { touch: true });
assert.equal(isAndroidRuntime(), true, "Android WebView wrapper should stay native");
markAndroidRuntime();
assert.equal(document.documentElement.dataset.platform, "android");
openInCurrentApp(new URLSearchParams({ capture: "1" }));
assert.equal(webview.assigned, "index.html?capture=1");

environment(androidChrome, { native: true });
assert.equal(isAndroidRuntime(), true, "Tauri Android bridge should be native");

environment(iosSafari, { touch: true });
assert.equal(isAndroidRuntime(), false);
assert.equal(prefersSingleWindowNavigation(), true, "iPhone Safari should use one tab");

environment(windows);
assert.equal(isAndroidRuntime(), false);
assert.equal(prefersSingleWindowNavigation(), false, "Desktop browser should retain popups");

environment(windows, { native: true });
assert.equal(prefersSingleWindowNavigation(), false, "Windows Tauri should retain native popups");

console.log("Heuresis browser/native navigation checks passed");
