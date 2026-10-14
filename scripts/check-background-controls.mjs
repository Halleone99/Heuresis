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
assert.match(settings, />Use default<\/button>/);
assert.match(background, /opacity: Math\.sqrt\(0\.6\)/);
assert.match(background, /veil: 1 - Math\.sqrt\(0\.6\)/);
assert.match(background, /fit: "cover"/);
assert.match(css, /\.settings-modal \.background-preview-canvas \{/);
assert.match(css, /\.settings-modal \.background-preview-example \{/);
console.log("Single Dim slider, legacy compatibility, live preview and focal-point tests passed.");
