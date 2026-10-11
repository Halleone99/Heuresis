import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
export const STATE_FILE = `${here}state.json`;
const PG = { host: process.env.PGHOST ?? "/tmp", port: process.env.PGPORT ?? "54329" };

export const BASE = process.env.HEURESIS_URL ?? "http://localhost:1421/";
export const SHOTS = process.env.SHOTS ?? `${here}../screenshots`;

export async function launch({ width = 1440, height = 900, scheme = "light", storageState } = {}) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, storageState, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log("[pageerror]", error.message); });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/page_backgrounds|status of 404|favicon/.test(text)) return;
    errors.push(text);
    console.log("[console.error]", text.slice(0, 400));
  });
  return { browser, context, page, errors };
}

export async function signIn(page) {
  await page.goto(BASE);
  await page.fill("input[type=email]", "thomas@example.test");
  await page.fill("input[type=password]", "heuresis");
  await page.click("button[type=submit]");
  await page.waitForSelector(".heuresis-section-sidebar", { timeout: 15000 });
  await page.waitForTimeout(800);
}

export async function section(page, label) {
  await page.click(`.hw-sections button:has-text("${label}")`);
  await page.waitForTimeout(400);
}

let step = 0;
export async function shot(page, name) {
  step += 1;
  const file = `${SHOTS}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  return file;
}

export function check(condition, message) {
  if (!condition) { console.log(`  ✗ ${message}`); process.exitCode = 1; return false; }
  console.log(`  ✓ ${message}`);
  return true;
}

export async function sql(query) {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("psql", ["-h", PG.host, "-p", PG.port, "-U", "postgres", "-d", "heuresis", "-At", "-c", query], { encoding: "utf8" }).trim();
}
