// Visual tour for review screenshots: node tests/tour.mjs <outdir> <width> <height> <light|dark>
import { mkdirSync } from "node:fs";
import { SHOTS, launch, signIn } from "./lib.mjs";
const [,, out = `${SHOTS}/tour`, width = "1440", height = "900", scheme = "light"] = process.argv;
mkdirSync(out, { recursive: true });
const { browser, page } = await launch({ width: Number(width), height: Number(height), scheme });
await signIn(page);
await page.evaluate((theme) => { localStorage.setItem("heuresis.theme.v1", theme); }, scheme);
await page.reload(); await page.waitForSelector(".heuresis-section-sidebar"); await page.waitForTimeout(900);
const snap = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: `${out}/${scheme}-${width}-${name}.png` }); };
const go = async (label) => { await page.click(`.hw-sections button:has-text("${label}")`); await page.waitForTimeout(500); };
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const want = (name) => !only.length || only.includes(name);

if (want("overview")) { await go("Overview"); await snap("overview"); }
if (want("topic")) {
  await go("Notebook");
  await page.keyboard.press("Control+KeyK"); await page.keyboard.type("Time expressions"); await page.waitForTimeout(150);
  await page.keyboard.press("Enter"); await page.waitForTimeout(600); await snap("topic");
}
if (want("doc")) {
  await go("Notebook");
  await page.keyboard.press("Control+KeyK"); await page.keyboard.type("的时候 — “when"); await page.waitForTimeout(150);
  await page.keyboard.press("Enter"); await page.waitForSelector(".nb-doc-title"); await snap("document");
  await page.mouse.wheel(0, 600); await snap("document-scrolled");
  await page.mouse.wheel(0, -2000);
  await page.keyboard.press("e"); await page.waitForSelector(".nb-editor"); await snap("document-editing");
  await page.keyboard.press("Escape");
}
if (want("lesson")) {
  await page.keyboard.press("Control+KeyK"); await page.keyboard.type("Chapter 4"); await page.waitForTimeout(150);
  await page.keyboard.press("Enter"); await page.waitForSelector(".nb-doc-title"); await snap("lesson");
  await page.mouse.wheel(0, 900); await snap("lesson-captures");
}
if (want("capture")) {
  await page.keyboard.press("Control+Shift+KeyN"); await page.keyboard.type("把字句: 我把书放在桌子上了 — is 了 needed here?"); await snap("capture-note");
  await page.keyboard.press("Control+Shift+KeyM"); await page.waitForTimeout(100); await snap("capture-mistake");
  await page.click(".qc-foot button:has-text('Discard')").catch(() => undefined);
  await page.keyboard.press("Escape");
}
if (want("mistakes")) {
  await go("Mistake Log"); await snap("mistakes");
  await page.click(".ws-page-actions button:has-text('Practise due')"); await page.waitForSelector(".ws-dialog.is-recall");
  await page.keyboard.type("我吃饭的时候他来了"); await page.keyboard.press("Control+Enter"); await snap("recall");
  await page.keyboard.press("Escape");
}
if (want("progress")) { await go("Progress"); await snap("progress"); }
if (want("search")) {
  await go("Notebook");
  await page.keyboard.press("Control+KeyK"); await page.keyboard.type("shihou"); await page.waitForTimeout(200); await snap("search");
  await page.keyboard.press("Escape");
}
if (want("home")) {
  await go("Notebook");
  await page.click(".nb-crumbs button:has-text('Notebook')").catch(async () => { await page.click(".nb-back"); });
  await page.waitForTimeout(300); await snap("notebook-home");
}
if (want("study")) {
  await go("Study"); await page.waitForTimeout(800); await snap("study");
  await page.click("text=HSK 2 — Time"); await page.waitForTimeout(1200); await snap("study-pack");
}
await browser.close();
