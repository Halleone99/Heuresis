import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createServer } from "vite";

const userId = randomUUID();
const articleId = randomUUID();
const textId = randomUUID();
const legacyId = randomUUID();
const date = new Date().toISOString();
let article = {
  id: articleId, user_id: userId, title: "Catalogue editing", status: "draft",
  updated_at: date, created_at: date, deleted_at: null,
  pages: [{ id: randomUUID(), blocks: [
    { id: textId, type: "text", content: "", align: "left", columns: 1 },
    { id: legacyId, type: "text", content: "4. Existing item\n5. Another item", align: "left", columns: 1 },
  ] }],
};
const folder = mkdtempSync("catalogue-editor-test-");
process.env.VITE_SUPABASE_URL = "https://catalogue-editor.test";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
writeFileSync(`${folder}/index.html`, '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
writeFileSync(`${folder}/fixture.tsx`, `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import CatalogueSection from "../src/components/catalogue/CatalogueSection";
  import { WorkspaceProvider } from "../src/components/workspace/WorkspaceContext";
  import "../src/components/workspace/workspace.css";
  const userId = ${JSON.stringify(userId)};
  createRoot(document.getElementById("root")!).render(
    <WorkspaceProvider userId={userId} section="catalogue" onSection={() => {}}>
      <CatalogueSection userId={userId} />
    </WorkspaceProvider>
  );
`);

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${folder}/`;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ userId, articleId }) => {
    sessionStorage.setItem(`heuresis.catalogue.route.v1:${userId}`, JSON.stringify({ view: "design", id: articleId }));
  }, { userId, articleId });
  let revision = 0;
  await context.route("https://catalogue-editor.test/**", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    let json = [];
    if (target.pathname.endsWith("/catalogue_articles")) {
      if (request.method() === "PATCH") {
        assert.equal(target.searchParams.get("updated_at"), `eq.${article.updated_at}`, "save uses the current revision");
        article = { ...article, ...request.postDataJSON(), updated_at: new Date(Date.parse(date) + ++revision).toISOString() };
      }
      json = [article];
    }
    await route.fulfill({ json });
  });
  const page = await context.newPage();
  await page.goto(url);
  const stage = page.locator(".ct-canvas");
  const field = stage.locator(`[data-block-id="${textId}"] .ap-editable`);
  const legacy = stage.locator(`[data-block-id="${legacyId}"] ol`);
  const saved = () => page.waitForFunction(() => document.querySelector(".ct-save")?.textContent === "Saved");
  await field.click();
  await field.press("1");
  await field.press(".");
  await field.press("Space");
  await page.keyboard.type("First  item");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Same item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("2026. Still a paragraph");
  assert.equal(await field.locator("ol > li").count(), 2);
  assert.equal(await field.locator("ol > li").first().innerText(), "First  item\nSame item");
  assert.equal(await field.locator("p").last().textContent(), "2026. Still a paragraph");
  assert.equal(await legacy.getAttribute("start"), "4");

  await page.keyboard.press("Enter");
  await field.evaluate((element) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Pasted  words\n\n\nAfter the gap");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.keyboard.press("Control+s");
  await saved();
  assert.equal(await field.evaluate((el) => document.activeElement === el), true, "Ctrl+S keeps the editor focused");
  await page.keyboard.insertText(" continued");
  await page.keyboard.press("Control+s");
  await saved();
  const expected = "1. First  item\u2028Same item\n2. Second item\n2026\\. Still a paragraph\nPasted  words\n\n\nAfter the gap continued";
  assert.equal(article.pages[0].blocks[0].content, expected);
  await page.reload();
  await field.waitFor();
  assert.equal(await field.locator("ol > li").count(), 2);
  assert.equal(await field.locator("ol > li").first().locator("br").count(), 1);
  assert.equal(await field.locator("p").count(), 5);
  assert.equal(await field.locator("p").first().textContent(), "2026. Still a paragraph");
  assert.equal(await field.locator("p").nth(1).textContent(), "Pasted  words");
  assert.equal(await field.evaluate((el) => getComputedStyle(el).whiteSpace), "pre-wrap");

  await field.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" in the draft");
  await page.getByRole("button", { name: "More block actions" }).click();
  await page.getByRole("menuitem", { name: "Duplicate block" }).click();
  await saved();
  assert.equal(article.pages[0].blocks.length, 3);
  const [original, copy] = article.pages[0].blocks;
  assert.equal(original.content, expected + " in the draft");
  assert.notEqual(copy.id, original.id);
  assert.deepEqual({ ...copy, id: original.id }, original);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved();
  assert.equal(article.pages[0].blocks.length, 2);

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.locator(`.ct-reader [data-block-id="${textId}"] .ap-text-body`);
  await preview.waitFor();
  assert.equal(await preview.locator("ol > li").first().locator("br").count(), 1);
  assert.equal(await preview.locator("p").count(), 5);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await field.click();
  await page.getByRole("button", { name: "More block actions" }).click();
  await page.getByRole("menuitem", { name: "Space above: large" }).click();
  await saved();
  assert.equal(article.pages[0].blocks[0].spaceBefore, "large");

  const legacyField = stage.locator(`[data-block-id="${legacyId}"] .ap-editable`);
  await legacyField.locator("li").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1.");
  await page.keyboard.press("Space");
  await page.keyboard.type("A new list starts at one");
  await page.keyboard.press("Control+s");
  await saved();
  await page.reload();
  await legacyField.waitFor();
  assert.equal(await legacyField.locator("ol").count(), 2);
  assert.equal(await legacyField.locator("ol").first().getAttribute("start"), "4");
  assert.equal(await legacyField.locator("ol").last().getAttribute("start"), null);
  assert.equal(await legacyField.locator("ol").last().innerText(), "A new list starts at one");

  const entries = Array.from({ length: 75 }, (_, i) => `${i + 4}. Entry ${i + 4}`);
  const flowed = await page.evaluate(async ({ article, entries }) => {
    const { flowOverflow } = await import("/src/components/catalogue/stage.tsx");
    const { normaliseArticle } = await import("/src/lib/catalogue/model.ts");
    const original = normaliseArticle(article);
    const page = original.pages[0];
    return flowOverflow({ ...original, pages: [{ ...page, blocks: [{ ...page.blocks[0], content: entries.join("\n") }] }] });
  }, { article, entries });
  assert.equal(flowed.unresolved.length, 0);
  assert.ok(flowed.pages.length > 1);
  assert.deepEqual(flowed.pages.flatMap((page) => page.blocks.flatMap((block) => block.content.split("\n"))), entries);
  console.log("Catalogue editor checks passed in Chromium.");
} finally {
  await browser?.close();
  await server.close();
  rmSync(folder, { recursive: true, force: true });
}
