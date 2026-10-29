import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const dir = "test-output/background-studio";
const port = 5196;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "/index.html", '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
writeFileSync(dir + "/fixture.tsx", [
  'import React, {useState} from "react";',
  'import {createRoot} from "react-dom/client";',
  'import SettingsModal from "../../src/components/SettingsModal";',
  'import {PAGE_BACKGROUND_CHOICES, DEFAULT_BACKGROUND_SETTINGS} from "../../src/hooks/useHeuresisBackground";',
  'import "../../src/theme/palettes.css";',
  'import "../../src/standalone-v2.css";',
  'import "../../src/components/workspace/workspace.css";',
  'import "../../src/settings-v2.css";',
  'function Demo() {',
  'const [images,setImages] = useState<Record<string,string>>({heuresis:"data:image/svg+xml,%3Csvg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"200\\" height=\\"120\\"%3E%3Crect width=\\"200\\" height=\\"120\\" fill=\\"%2367828a\\"/%3E%3C/svg%3E"});',
  'const [settings,setSettings] = useState<Record<string,typeof DEFAULT_BACKGROUND_SETTINGS>>({});',
  'const backgrounds = Object.fromEntries(PAGE_BACKGROUND_CHOICES.map(({key}) => [key,{',
  ' imageUrl:images[key]||null, hasImage:Boolean(images[key]), settings:settings[key]??DEFAULT_BACKGROUND_SETTINGS, syncing:false,syncError:"",',
  ' updateSettings:(patch:Partial<typeof DEFAULT_BACKGROUND_SETTINGS>)=>setSettings(v=>({...v,[key]:{...DEFAULT_BACKGROUND_SETTINGS,...v[key],...patch}})),',
  ' chooseImage:async(file:File)=>setImages(v=>({...v,[key]:URL.createObjectURL(file)})),',
  ' removeImage:async()=>setImages(v=>({...v,[key]:""}))',
  '}]));',
  'return <div className="heuresis-desktop"><SettingsModal backgrounds={backgrounds as any} packs={[]} collections={[]} onDataChanged={()=>undefined} onClose={()=>undefined}/></div>;',
  '}',
  'createRoot(document.getElementById("root")!).render(<Demo />);',
].join("\n"));

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host","127.0.0.1","--port",String(port),"--strictPort"], {stdio:"pipe"});
let serverLog = "";
server.stderr.on("data", d => {serverLog += d.toString();});
server.stdout.on("data", d => {serverLog += d.toString();});
const browser = await chromium.launch({headless:true});
const url = "http://127.0.0.1:" + port + "/test-output/background-studio/index.html";
try {
  for(let i=0;i<60;i++){
    if(server.exitCode!==null) throw new Error("Vite exited: "+serverLog);
    try {if((await fetch(url)).ok)break;}catch{}
    if(i===59)throw new Error("Vite failed to start: "+serverLog);
    await sleep(250);
  }
  const page = await browser.newPage({ viewport:{width:1200,height:900} });
  await page.goto(url);
  const pages = page.getByLabel("Page",{exact:true});
  await pages.selectOption("heuresis-study");
  const upload = page.getByRole("button",{name:"Upload image"});
  await upload.waitFor();
  const geometry = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {upload:rect(".pb-upload-primary"),canvas:rect(".background-preview-canvas"),
      caption:rect(".background-preview-caption"),presets:rect(".pb-presets-panel")};
  });
  assert(geometry.upload && geometry.canvas && geometry.upload.bottom < geometry.canvas.top,
    "Image uploader must sit ABOVE the preview instead of being hidden beneath it: "+JSON.stringify(geometry));
  assert(geometry.caption && geometry.presets && geometry.canvas.right + 8 <= geometry.presets.left,
    "Preview and atmosphere choices must sit side by side without overlap: "+JSON.stringify(geometry));
  const canvas = page.locator(".background-preview-canvas");
  assert.equal(await canvas.isDisabled(),true,"Page with only the shared fallback cannot edit shared image focus");
  const fallbackOpacity = await canvas.evaluate(el=>getComputedStyle(el).opacity);
  assert.equal(fallbackOpacity,"1","Shared fallback remains visible instead of being faded as disabled");
  await page.getByRole("button",{name:"Mist",exact:true}).click();
  // The shared fallback is already an image; await the NEW page image upload.
  await page.getByRole("button",{name:"Change image"}).waitFor();
  await page.locator(".background-preview-canvas img").waitFor();
  await page.getByText("More adjustments").click();
  assert.equal(await page.getByRole("group",{name:"Background fit"}).getByRole("button",{name:"Fit"}).isEnabled(),true);
  await page.getByRole("group",{name:"Background fit"}).getByRole("button",{name:"Fit"}).click();
  assert.equal(await page.locator(".background-preview-canvas img").evaluate(el=>getComputedStyle(el).objectFit),"contain");
  await pages.selectOption("heuresis-notebook");
  assert.equal(await page.getByRole("button",{name:"Upload image"}).isVisible(),true);
  assert.equal(await page.locator(".pb-advanced").count(),0,"Fine-tuning is hidden on inherited pages");
  assert.equal(await page.locator(".background-preview-canvas").isDisabled(),true);
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAusB9WlLT5sAAAAASUVORK5CYII=","base64");
  await page.locator('input[type="file"]').setInputFiles({name:"own.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"Change image"}).waitFor();
  await pages.selectOption("heuresis-study");
  assert.equal(await page.getByRole("button",{name:"Change image"}).isVisible(),true,"Study retains its own chosen preset");
  console.log("Background Studio: compact page selector, clear fallback, atmosphere presets, disclosure, fit and independent uploads passed.");
  await page.close();
} finally {
  await browser.close();
  server.kill("SIGTERM");
  rmSync(dir,{recursive:true,force:true});
}
