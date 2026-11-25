import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const userId = randomUUID();
const subjectId = randomUUID();
const lessonsId = randomUUID();
const referenceId = randomUUID();
const date = "2026-11-25T12:00:00.000Z";
const backend = "https://notes-v2.test";
process.env.VITE_SUPABASE_URL = backend;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";

const note = (title, body, fields = {}) => ({
  id: randomUUID(), user_id: userId, topic_id: lessonsId, kind: "note", title, body,
  category: "note", pinned: false, lesson_id: null, recall_due_at: null, created_at: date, updated_at: date, ...fields,
});
const phrases = note("Small Talk", "我还不错，谢谢。你呢？\n\nWǒ hái búcuò, xièxie. Nǐ ne?\n\n今天是星期日。\nJīntiān shì xīngqīrì.\n\n[[Selection Review]]", { pinned: true });
const homework = note("Homework", "Practise asking the time.");
const table = note("Selection Review", [
  "# Vocabulary", "",
  "| # | 中文 | Pinyin | English | Review |", "| --- | --- | --- | --- | --- |",
  "| 1 | 生日 | shēngrì | birthday | □ |",
  ...Array.from({ length: 32 }, (_, i) => `| ${i + 2} | 礼物 | lǐwù | present ${i + 1} | □ |`),
  "", "## Examples", "", "今天是我的生日。",
].join("\n"), { topic_id: referenceId, category: "reference" });
const records = [phrases, homework, table];
const topics = [
  { id: lessonsId, name: "Liwei Lessons" },
  { id: referenceId, name: "Language Reference" },
].map((topic) => ({ ...topic, subject_id: subjectId, user_id: userId, parent_id: null, created_at: date, updated_at: date }));
const subjects = [{ id: subjectId, name: "Chinese", user_id: userId, created_at: date, updated_at: date }];
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: "dark" });
  await context.addInitScript(({ userId }) => {
    const user = { id: userId, email: "lessons@example.test", aud: "authenticated", role: "authenticated" };
    localStorage.setItem("sb-notes-v2-auth-token", JSON.stringify({
      access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, { userId });
  await context.route(`${backend}/**`, async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    const id = target.searchParams.get("id")?.slice(3);
    if (target.pathname.endsWith("/knowledge_records") && request.method() === "PATCH") {
      const entry = records.find((record) => record.id === id);
      assert.ok(entry, "Pinning updates an existing note");
      Object.assign(entry, request.postDataJSON());
      await route.fulfill({ json: entry });
      return;
    }
    const data = {
      "/rest/v1/knowledge_subjects": subjects,
      "/rest/v1/knowledge_topics": topics,
      "/rest/v1/knowledge_records": records,
    }[target.pathname] ?? [];
    await route.fulfill({ json: id ? data.filter((row) => row.id === id) : data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  context.on("page", (view) => view.on("pageerror", (error) => errors.push(error.message)));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator(".hw-sections").getByRole("button", { name: "Notebook" }).click();
  await page.locator(".nb-home-subjects").getByRole("button", { name: /^Chinese/ }).click();
  await page.locator(".nb-topic-grid").getByRole("button", { name: /Liwei Lessons/ }).click();
  await page.getByRole("button", { name: "Cards view" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Board view" }).count(), 0);

  await page.getByLabel("Account menu").click();
  await page.getByRole("button", { name: "Settings & appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Heuresis settings" });
  await settings.getByRole("button", { name: "Notes", exact: true }).click();
  await settings.getByRole("button", { name: "Notes 2.0" }).click();
  await settings.getByRole("button", { name: "Close settings" }).click();
  const preview = page.getByRole("region", { name: "Note preview" });
  await preview.getByRole("heading", { name: "Small Talk" }).waitFor();
  assert.match(await preview.locator(".nb-v2-phrase").first().innerText(), /我还不错.*\s+Wǒ hái búcuò/u);
  if (process.env.NOTES_SCREENSHOTS) await page.screenshot({ path: join(process.env.NOTES_SCREENSHOTS, "board.png") });
  await page.getByRole("button", { name: "Homework", exact: true }).click();
  await preview.getByRole("heading", { name: "Homework" }).waitFor();
  await preview.getByRole("button", { name: "Pin note", exact: true }).click();
  await page.getByRole("region", { name: "Pinned" }).getByRole("button", { name: "Homework" }).waitFor();
  assert.equal(homework.pinned, true);

  const topicSearch = page.getByRole("searchbox", { name: "Search notes in this topic" });
  await topicSearch.fill("wo bucuo");
  await preview.getByRole("heading", { name: "Small Talk" }).waitFor();
  assert.equal(await preview.locator(".nb-v2-phrase").count(), 1);
  await preview.getByRole("button", { name: "Open note" }).click();
  const reader = page.getByRole("combobox", { name: "Reading view" });
  await reader.selectOption("lesson");
  await page.getByRole("searchbox", { name: "Find in this note" }).fill("星期日");
  await page.getByText("1 match", { exact: true }).waitFor();
  assert.equal(await page.locator(".nb-v2-phrase").count(), 1);
  await page.getByRole("button", { name: "Close note" }).click();
  assert.equal(await topicSearch.inputValue(), "wo bucuo", "Board search survives opening and closing a document");

  const popupEvent = page.waitForEvent("popup");
  await preview.getByRole("button", { name: "Open lesson companion" }).click();
  const popup = await popupEvent;
  popup.setDefaultTimeout(8000);
  await popup.getByRole("heading", { name: "Small Talk" }).waitFor();
  if (process.env.NOTES_SCREENSHOTS) {
    await popup.setViewportSize({ width: 490, height: 680 });
    await popup.screenshot({ path: join(process.env.NOTES_SCREENSHOTS, "companion.png") });
  }
  assert.match(popup.url(), /companion=1/);
  await popup.getByRole("button", { name: "Chinese notes" }).click();
  await popup.getByRole("searchbox", { name: "Find notes or phrases" }).fill("shengri");
  await popup.locator("#companion-notes").getByRole("button", { name: /Selection Review/ }).click();
  await popup.getByRole("heading", { name: "Selection Review" }).waitFor();
  assert.equal(context.pages().length, 2, "Switching notes stays in the same companion window");
  const compactTable = popup.getByRole("table");
  await compactTable.waitFor();
  assert.equal(await compactTable.getByRole("row").count(), 2);
  await popup.getByRole("button", { name: "Clear note search" }).click();
  await popup.waitForFunction(() => document.querySelectorAll("tbody tr").length === 33);
  const scroll = popup.getByRole("region", { name: /^Table:/ });
  const sticky = await scroll.evaluate((element) => {
    const header = element.querySelector("th");
    element.scrollTop = 220;
    return { scroll: element.scrollTop, position: getComputedStyle(header).position,
      offset: header.getBoundingClientRect().top - element.getBoundingClientRect().top };
  });
  assert.ok(sticky.scroll > 0 && sticky.position === "sticky" && Math.abs(sticky.offset) < 3,
    "Table headings stay visible when scrolling long tables");

  await popup.getByRole("link", { name: "Open full note" }).click();
  await popup.getByRole("combobox", { name: "Reading view" }).selectOption("document");
  await popup.getByRole("button", { name: "Back to companion" }).click();
  await popup.getByRole("button", { name: "Chinese notes" }).waitFor();
  await popup.close();
  await page.evaluate(() => { window.open = () => null; });
  await preview.getByRole("button", { name: "Open lesson companion" }).click();
  await page.getByText("Pop-up blocked. You can use the preview here.", { exact: true }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".nb-v2-board").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
  await preview.getByRole("button", { name: "Open note" }).click();
  assert.equal(await page.locator(".nb-doc").evaluate((element) =>
    element.getBoundingClientRect().right <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
  console.log("Notes 2.0 passed Chromium checks for Settings, Board, pinning, Hanzi/Pinyin lookup, pop-ups, sticky tables and narrow layouts.");
} finally {
  await browser?.close();
  await server.close();
}
