import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const code=ts.transpileModule(readFileSync("src/lib/backgroundDim.ts","utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText;
const mod={exports:{}};
new Function("module","exports",code)(mod,mod.exports);
const {dimPercent,dimToLegacySettings}=mod.exports;
for(const value of [0,5,15,40,65,90,95,100]){
  const settings=dimToLegacySettings(value);
  assert.equal(dimPercent(settings.opacity,settings.veil),value);
  assert.ok(settings.opacity >= 0 && settings.opacity <= 1);
  assert.ok(settings.veil >= 0 && settings.veil <= 1);
}
assert.equal(dimPercent(.32,.55),86, "Legacy opacity and veil should read as one Dim value");
assert.deepEqual(dimToLegacySettings(-100),{opacity:1,veil:0});
assert.equal(dimPercent(...Object.values(dimToLegacySettings(999))),100);
const settings=readFileSync("src/components/SettingsModal.tsx","utf8");
const background=readFileSync("src/hooks/useHeuresisBackground.ts","utf8");
const css=readFileSync("src/components/workspace/workspace.css","utf8");
assert.match(settings, /<span>Dim<\/span><input type="range"/);
assert.match(settings, /background\.updateSettings\(dimToLegacySettings\(Number\(event\.target\.value\)\)\)/);
assert.doesNotMatch(settings, /<span>Image opacity<\/span>/);
assert.doesNotMatch(settings, /<span>Readability veil<\/span>/);
assert.match(settings, /className="background-preview-example"/);
assert.match(settings, /className="background-preview-veil"/);
assert.match(settings, /style=\{\{ opacity: background\.settings\.opacity/);
assert.match(settings, /opacity: background\.settings\.veil/);
assert.match(settings, /function setFocal\(event: MouseEvent<HTMLButtonElement>\)/);
assert.match(settings, /fraction < 1 \/ 3 \? "top" : fraction > 2 \/ 3 \? "bottom" : "center"/);
assert.doesNotMatch(settings, /\[["']cover["'],\s*["']contain["']\]/);
assert.match(settings, /Use default<\/button>/);
assert.match(background, /opacity: Math\.sqrt\(0\.6\)/);
assert.match(background, /veil: 1 - Math\.sqrt\(0\.6\)/);
assert.match(background, /fit: "cover"/);
assert.match(css, /\.settings-modal \.background-preview-canvas \{/);
assert.match(css, /\.settings-modal \.background-preview-example \{/);
// Each workspace page can override the retained all-pages wallpaper.
const app=readFileSync("src/App.tsx","utf8");
for(const page of ["overview","study","notebook","mistakes","reading","quotations","reference","queue"]){
  assert.match(background,new RegExp(`key: "heuresis-${page}"`));
  assert.match(app,new RegExp(`useHeuresisBackground\\("heuresis-${page}"\\)`));
}
assert.match(background,/page === "heuresis" \? "pos\.pageBackground\.heuresis\.v1"/);
assert.match(background,/get\(page\)/, "Page backgrounds have separate offline cache keys");
assert.match(background,/\.eq\("page_key", page\)/, "Cloud images are stored separately per page");
assert.match(app,/specificBackground\?\.hasImage && specificBackground\.settings\.enabled/, "Individual wallpaper overrides shared default");
assert.match(app,/navigateSection\("overview"\)\} aria-label="Heuresis — go to Overview"/, "The header wordmark returns to Overview");
assert.match(settings,/PAGE_BACKGROUND_CHOICES\.map/, "Settings shows all page choices");
assert.match(settings,/selectedPage === "heuresis"/, "Default background is identified");
assert.doesNotMatch(css, /not\(\[data-section="study"\]\) :is\(\.heuresis-wallpaper/, "Custom backgrounds must not disappear on Notebook pages");
console.log("Single Dim slider, per-page backgrounds, default fallback and Heuresis home navigation passed.");
