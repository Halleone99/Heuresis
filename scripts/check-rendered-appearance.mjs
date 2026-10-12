import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Load CSS in the same order as src/main.tsx, including the last-loaded
// canonical chrome file. This fixture needs no account or live database.
const main = readFileSync("src/main.tsx", "utf8");
const imports = [...main.matchAll(/^import\s+["'](\.\/[^"']+\.css)["'];?$/gm)].map((match) => match[1]);
assert.ok(imports.at(-1) === "./theme/chrome.css", "Canonical chrome should load last");
const css = imports.map((file) => readFileSync(resolve("src", file.slice(2)), "utf8")).join("\n");
const palettes = ["slate", "forest", "sepia", "neutral"];
const modes = ["light", "dark"];
const fixtures = `
<div class="heuresis-desktop" data-section="study">
  <header class="desktop-chrome">
    <button id="wordmark" class="desktop-wordmark"><span class="desktop-mark-wrap" id="mark">ε</span><span class="desktop-wordmark-name">Heuresis</span></button>
    <nav class="desktop-nav-group">
      <button id="nav" class="desktop-nav-item">Library</button>
      <button id="nav-active" class="desktop-nav-item active">Catalogue</button>
    </nav>
    <span class="desktop-spacer"></span>
    <div class="desktop-header-actions">
      <button id="sync-disabled" class="desktop-action" disabled>Syncing</button>
      <button id="search" class="desktop-action desktop-search-action"><span>Search notes</span><kbd>Ctrl K</kbd></button>
      <button id="card" class="desktop-action desktop-primary">Card</button>
      <button id="capture" class="desktop-action hw-capture-button">Capture</button>
      <details class="desktop-account-menu" open><summary><span class="desktop-account-avatar">H</span></summary>
        <div class="desktop-account-popover">
          <div class="desktop-account-identity"><span>ACCOUNT</span><strong>Account</strong></div>
          <button id="account">Settings &amp; appearance</button>
        </div>
      </details>
    </div>
  </header>
  <main class="desktop-content">
    <div class="topic-utility-actions"><button class="secondary-button" id="study-secondary">Settings</button></div>
    <div class="capture-slot"><textarea id="capture-field" placeholder="Chinese / Pinyin / English"></textarea></div>
    <div class="capture-foot-actions"><button id="disabled-capture" disabled>Add another</button></div>
    <button id="disabled-primary" class="primary-button" disabled>Unavailable</button>
    <button id="disabled-browse" class="browse-start-button" disabled>Start</button>
  </main>
</div>`;

// Convert RGB(A) computed colours to RGBA channels.
function parse(value) {
  const input = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(input)) return [...input.slice(1).match(/../g).map((v) => parseInt(v, 16)), 1];
  const colorSrgb = input.match(/^color\(srgb\s+([^)]+)\)$/);
  if (colorSrgb) {
    const [channels, alpha = "1"] = colorSrgb[1].split("/");
    const parts = channels.trim().split(/\s+/).map(Number);
    assert.equal(parts.length, 3, "Unexpected srgb: " + input);
    return [...parts.map((n) => Math.max(0, Math.min(255, n * 255))), Number(alpha.trim())];
  }
  const match = input.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)$/i);
  assert.ok(match, "Unexpected browser-computed colour: " + value);
  return [+match[1], +match[2], +match[3], match[4] === undefined ? 1 : +match[4]];
}
function composite(foreground, background) {
  const a = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    ...[0, 1, 2].map((i) => (foreground[i] * foreground[3] + background[i] * background[3] * (1 - foreground[3])) / a),
    a,
  ];
}
function luminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, reducedMotion: "reduce" });
  mkdirSync("test-output/appearance", { recursive: true });
  for (const palette of palettes) for (const mode of modes) {
    await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}"><head><meta charset="UTF-8"><style>${css}</style></head><body>${fixtures}</body></html>`);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    for (const id of ["mark", "nav", "nav-active", "search", "card", "capture", "account", "sync-disabled", "disabled-capture", "disabled-primary", "disabled-browse"]) {
      const result = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const fg = getComputedStyle(el).color;
        const layers = [];
        for (let current = el; current; current = current.parentElement) {
          layers.push(getComputedStyle(current).backgroundColor);
        }
        // Start with the computed page colour; composite surfaces from root to text.
        const pageColor = getComputedStyle(document.documentElement).getPropertyValue("--ws-page").trim();
        const fallback = document.createElement("span");
        fallback.style.color = pageColor;
        document.body.append(fallback);
        const pageRgb = getComputedStyle(fallback).color;
        fallback.remove();
        return { foreground: fg, layers: layers.reverse(), pageRgb };
      }, id);
      let bg = parse(result.pageRgb);
      for (const layer of result.layers) {
        const next = parse(layer);
        if (next[3] > 0) bg = composite(next, bg);
      }
      const fg = composite(parse(result.foreground), bg);
      const actual = contrast(fg, bg);
      assert.ok(actual >= 4.5, `${palette}/${mode} #${id}: text contrast ${actual.toFixed(2)}:1 < 4.5:1; fg ${result.foreground}, bg ${JSON.stringify(bg)}, layers ${JSON.stringify(result.layers)}`);
    }
    // Browser's actual input placeholder, not just the declared colour token.
    const placeholder = await page.evaluate(() => {
      const el = document.getElementById("capture-field");
      return {
        fg: getComputedStyle(el, "::placeholder").color,
        bg: getComputedStyle(el).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--ws-surface"),
      };
    });
    const placeholderBackground = parse(placeholder.bg)[3] > .99 ? parse(placeholder.bg) : parse(placeholder.surface);
    assert.ok(contrast(parse(placeholder.fg), placeholderBackground) >= 4.5, `${palette}/${mode}: capture placeholder too faint`);
    await page.screenshot({ path: `test-output/appearance/${palette}-${mode}.png`, fullPage: true });
  }
  console.log("Rendered Chrome: 8 palette/mode combinations passed for 11 header/dialog/disabled labels and Capture placeholder. Screenshots saved.");
} finally {
  await browser.close();
}
