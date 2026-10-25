// Proof that the Android tablet layer leaves the Windows app as it was.
//
// Drives two builds side by side against the same database: the build under test and a
// reference build (HEURESIS_REFERENCE_URL, e.g. the previous commit served on another
// port). The same Study screens are captured in each and compared pixel by pixel, for:
//   * the Windows desktop app (WebView2 user agent, Tauri runtime stand-in, mouse);
//   * a Windows touchscreen laptop (coarse pointer, but not Android);
// at a large window and at a 1200 px window. Then the Windows Review window must still
// close itself through Tauri, as before.
//   HEURESIS_REFERENCE_URL=http://localhost:1422/ node tests/desktop-unchanged.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BASE, check, sql } from "./lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const shots = `${here}screenshots/desktop-unchanged`;
mkdirSync(shots, { recursive: true });
const REFERENCE = process.env.HEURESIS_REFERENCE_URL;
if (!REFERENCE) throw new Error("Set HEURESIS_REFERENCE_URL to the reference build.");
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
const USER = "11111111-1111-4111-8111-111111111111";
const HSK = "a0000000-0000-4000-8000-000000000001";

function restore() { execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" }); }

function windowsTauriStandIn() {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: { path: { sep: "\\", delimiter: ";" } },
    transformCallback() { return 1; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(cmd) {
      try { const calls = JSON.parse(sessionStorage.getItem("__calls") || "[]"); calls.push(cmd); sessionStorage.setItem("__calls", JSON.stringify(calls)); } catch { /* bookkeeping */ }
      if (cmd.startsWith("local_backup_")) throw new Error("not in this test");
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

const PROFILES = [
  { name: "windows-1440", viewport: { width: 1440, height: 900 }, touch: false },
  { name: "windows-1200", viewport: { width: 1200, height: 800 }, touch: false },
  { name: "windows-touch-1200", viewport: { width: 1200, height: 800 }, touch: true },
];

async function capture(base, profile, label) {
  restore();
  await sql(`insert into heuresis_cards(user_id, pack_id, data) values ('${USER}','${HSK}','{"term":"马上","reading":"mǎshàng","meaning":"immediately"}')`);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: profile.viewport, hasTouch: profile.touch, isMobile: false, userAgent: WINDOWS_UA, reducedMotion: "reduce" });
  await context.addInitScript(windowsTauriStandIn);
  const page = await context.newPage();
  const files = {};
  const snap = async (key) => {
    await page.waitForTimeout(500);
    await page.mouse.move(1, 1);
    const file = `${shots}/${profile.name}-${key}-${label}.png`;
    await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
    files[key] = file;
  };
  try {
    await page.goto(base);
    await page.fill("input[type=email]", "thomas@example.test");
    await page.fill("input[type=password]", "heuresis");
    await page.click("button[type=submit]");
    await page.waitForSelector(".heuresis-section-sidebar", { timeout: 15000 });
    files.platform = await page.evaluate(() => document.documentElement.dataset.platform ?? "(none)");
    await page.click('.hw-sections button:has-text("Study")');
    await page.waitForTimeout(800);
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.locator(".modern-topic-row").first().waitFor();
    await snap("topic");
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    await snap("sort");
    await page.keyboard.press("Escape");
    await page.click(".review-adjust");
    await page.locator(".study-start").waitFor();
    await page.waitForTimeout(600);
    await snap("adjust");
    await page.keyboard.press("Escape");
    await page.click('.topic-learning-actions button:has-text("Browse")');
    await page.locator(".browse-start-button").click();
    await page.locator(".modern-browse-card").waitFor();
    await snap("browse");
    // The Review window, opened as Windows opens it (its own window, same URL).
    const review = await context.newPage();
    await review.goto(`${base}index.html?cosmos=1&mode=review&pack=${HSK}&source=all&order=pack&count=20`);
    await review.locator(".cosmos-count").waitFor({ timeout: 15000 });
    await review.waitForTimeout(600);
    await review.mouse.move(1, 1);
    files["review-front"] = `${shots}/${profile.name}-review-front-${label}.png`;
    await review.screenshot({ path: files["review-front"], animations: "disabled", caret: "hide" });
    // Space, as on Windows: at 1180–1240 px the side panels already cover the card there
    // (an existing desktop layout issue this change deliberately leaves alone).
    await review.keyboard.press(" ");
    await review.locator(".cosmos-results").waitFor();
    await review.waitForTimeout(400);
    await review.mouse.move(1, 1);
    files["review-revealed"] = `${shots}/${profile.name}-review-revealed-${label}.png`;
    await review.screenshot({ path: files["review-revealed"], animations: "disabled", caret: "hide" });
    files.hint = await review.locator(".cosmos-review-foot").innerText().catch(() => "");
    await review.locator(".cosmos-close").click({ force: true });
    await review.waitForTimeout(800);
    files.closeCalls = await review.evaluate(() => sessionStorage.getItem("__calls") || "[]").catch(() => "[]");
  } finally { await browser.close(); }
  return files;
}

function diffRatio(a, b) {
  const out = execFileSync("python3", ["-I", "-c", `
import sys
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert("RGB"); b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size: print("size"); sys.exit()
d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 8 else 0)
print(sum(d.histogram()[255:]) / (a.size[0] * a.size[1]))
`, a, b], { encoding: "utf8" }).trim();
  return out === "size" ? 1 : Number(out);
}

const report = [];
for (const profile of PROFILES) {
  console.log(`— ${profile.name}: this build against the reference build`);
  const mine = await capture(BASE, profile, "this");
  const theirs = await capture(REFERENCE, profile, "reference");
  check(mine.platform === "(none)", `the Windows app is not marked as Android (${mine.platform})`);
  for (const key of ["topic", "sort", "adjust", "browse", "review-front", "review-revealed"]) {
    const ratio = diffRatio(mine[key], theirs[key]);
    report.push({ profile: profile.name, screen: key, differingPixels: ratio });
    check(ratio < 0.001, `${key}: identical to the reference build (${(ratio * 100).toFixed(3)}% of pixels differ)`);
  }
  check(mine.hint === theirs.hint, "Review's instructions are the desktop wording, unchanged");
  check(/plugin:window\|close/.test(mine.closeCalls), "the Windows Review window still closes itself through Tauri");
}
writeFileSync(`${shots}/report.json`, JSON.stringify(report, null, 2));
if (process.exitCode) console.log("Desktop: differences found.");
else console.log("Desktop: unchanged by the Android tablet layer.");
