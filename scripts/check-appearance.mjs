import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync("src/theme/palettes.css", "utf8");
const html = readFileSync("index.html", "utf8");
const js = readFileSync("src/lib/theme.ts", "utf8");
const expected = ["slate", "forest", "sepia", "neutral"];
const keys = ["ws-page", "ws-surface", "ws-sunken", "ws-ink", "ws-text", "ws-muted", "ws-accent", "ws-primary", "ws-on-primary"];
function luminance(hex) {
  const values = hex.slice(1).match(/.{2}/g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
let combinations = 0;
for (const palette of expected) for (const mode of ["light", "dark"]) {
  const re = new RegExp(':root\\[data-palette="' + palette + '"\\]\\[data-theme="' + mode + '"\\]\\s*\\{([^}]+)\\}');
  const match = css.match(re);
  assert.ok(match, `Missing ${palette}/${mode}`);
  const tokens = Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((item) => [item[1], item[2]]));
  for (const key of keys) assert.ok(tokens[key], `Missing ${key} in ${palette}/${mode}`);
  for (const [foreground, background, minimum] of [
    ["ws-ink", "ws-surface", 7], ["ws-text", "ws-surface", 7],
    ["ws-muted", "ws-sunken", 4.5], ["ws-accent", "ws-sunken", 4.5],
    ["ws-on-primary", "ws-primary", 7],
  ]) {
    const value = ratio(tokens[foreground], tokens[background]);
    assert.ok(value >= minimum, `${palette}/${mode}: ${foreground} on ${background} is ${value.toFixed(2)}:1`);
  }
  combinations++;
}
for (const key of ["heuresis.theme.v1", "heuresis.palette.v1"]) {
  assert.ok(html.includes(key), `Pre-paint script missing ${key}`);
  assert.ok((js + readFileSync("src/lib/workspaceMemory.ts", "utf8")).includes(key), `Appearance logic missing ${key}`);
}


const files = {
  palette: css,
  capture: readFileSync("src/popup-system.css", "utf8"),
  related: readFileSync("src/components/related.css", "utf8"),
  study: readFileSync("src/topic-elegance-pass.css", "utf8"),
  sort: readFileSync("src/components/sort.css", "utf8"),
  account: readFileSync("src/App.tsx", "utf8"),
  auth: readFileSync("src/styles.css", "utf8"),
};
for (const [palette, mode] of expected.flatMap((palette) => ["light", "dark"].map((mode) => [palette, mode]))) {
  const start = css.indexOf(':root[data-palette="' + palette + '"][data-theme="' + mode + '"] {');
  const block = start >= 0 ? css.slice(start, css.indexOf("}", start)) : "";
  assert.ok(block?.includes("--ws-scrim:"), `Missing dialog scrim in ${palette}/${mode}`);
  assert.ok(block?.includes("--ws-on-chrome-accent:"), `Missing chrome button contrast in ${palette}/${mode}`);
}
assert.match(css, /\.desktop-chrome \.desktop-account-popover :is\(button,span,small,svg,strong\)/, "Account popover must override dark chrome text");
assert.match(css, /:is\(input,textarea,select\)::placeholder \{ color:var\(--ws-muted\); opacity:1; \}/, "Input placeholder contrast");
assert.match(files.capture, /capture-slot textarea::placeholder \{ color: var\(--ws-muted\)/, "Capture placeholder contrast");
assert.doesNotMatch(files.capture, /(?:^|[;{])\s*color:\s*var\(--ws-line(?:-strong)?\)/m, "Capture separators must not use border tokens as text");
assert.doesNotMatch(files.related, /#[0-9a-f]{3,8}\b/i, "Related editor must use palette or semantic tokens");
assert.match(files.auth, /\.auth-card input \{/, "Sign-in form inputs must be styled");
assert.match(files.sort, /\.sort-backdrop\{[^}]*background:var\(--ws-scrim\)/, "Sort modal must use a neutral scrim");
assert.match(files.study, /\.sort-command b \{[^}]*color: var\(--ws-on-primary\)/, "Sort badge must use contrast-safe text");
console.log(`Appearance: ${combinations} palette/mode token-contrast checks, plus cross-component CSS regression checks passed.`);
