import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync("src/components/workspace/workspace.css", "utf8");
const palettes = readFileSync("src/theme/palettes.css", "utf8");
const active = css.match(/\.heuresis-desktop\[data-sidebar\] \.hw-sections button\.active \{([\s\S]*?)\}/)?.[1] ?? "";
assert.ok(active.includes("var(--ws-chrome-accent) 72%"), "Selected section needs a palette-aware accent indicator");
assert.ok(!active.includes("inset 3px 0 0 var(--ws-chrome-text)"), "Old unthemed white sidebar bar must be removed");
assert.match(css,/\.hw-nb-home\.is-active,\.hw-nb-row\.is-active \{[^}]+var\(--ws-chrome-accent\)/);
assert.match(css,/\.heuresis-desktop :is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), textarea, \[contenteditable="true"\]\)/);
assert.match(css,/\.quick-floating-root :is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), textarea, \[contenteditable="true"\]\)/);
assert.match(css,/caret-color: var\(--ws-accent\)/);
assert.match(css,/\.heuresis-desktop \.desktop-content ::selection/);
assert.match(css,/\.quick-floating-root ::selection/);
assert.match(css,/\.heuresis-desktop \.desktop-content ::-moz-selection/);
assert.match(css,/color: var\(--ws-ink\);/);
assert.ok((palettes.match(/--ws-chrome-accent: var\(--ws-accent\);/g) ?? []).length >= 8,
  "All four light/dark palettes must provide chrome accent tokens");
console.log("Active-sidebar accents and editor/selection accents passed for all palettes.");
