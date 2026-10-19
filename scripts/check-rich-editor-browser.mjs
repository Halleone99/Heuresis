import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const dir = "test-output/rich-editor";
const port = 5189;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + "/index.html", '<!doctype html><html><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
writeFileSync(dir + "/fixture.tsx", [
  'import React, { useState } from "react";',
  'import { createRoot } from "react-dom/client";',
  'import { RichEditor } from "../../src/components/workspace/RichEditor";',
  'import "../../src/components/workspace/workspace.css";',
  'import "../../src/components/workspace/note-formatting.css";',
  'function Demo() {',
  'const [text, setText] = useState("你好\\nNǐ hǎo\\nHello");',
  'return <div className="heuresis-desktop" style={{maxWidth:800,margin:24}}>',
  '<RichEditor value={"你好\\nNǐ hǎo\\nHello"} resetKey="regression" onChange={setText} />',
  '<pre data-testid="markdown">{text}</pre></div>;',
  '}',
  'createRoot(document.getElementById("root")!).render(<Demo />);',
].join("\n"));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "pipe" });
let output = "";
server.stderr.on("data", (data) => { output += String(data); });
server.stdout.on("data", (data) => { output += String(data); });
const browser = await chromium.launch({ headless: true });
const url = "http://127.0.0.1:" + port + "/test-output/rich-editor/index.html";

async function select(page, line, text = null, wholeBlock = false) {
  const done = await page.evaluate(({ line, text, wholeBlock }) => {
    const root = document.querySelector(".nb-editor");
    if (!root) return false;
    const block = root.querySelectorAll("p")[line];
    if (!block) return false;
    root.focus();
    const range = document.createRange();
    if (wholeBlock) range.selectNode(block);
    else {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node, found = false;
      while ((node = walker.nextNode())) {
        const start = node.textContent.indexOf(text);
        if (start < 0) continue;
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        found = true;
        break;
      }
      if (!found) return false;
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return sel.toString().trim().length > 0;
  }, { line, text, wholeBlock });
  assert.equal(done, true, "Failed to select note text");
}
async function waitForText(page, fragment) {
  await page.waitForFunction((part) => document.querySelector('[data-testid="markdown"]')?.textContent?.includes(part), fragment, { timeout: 6000 });
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Vite exited: " + output);
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt === 59) throw new Error("Vite did not start: " + output);
    await sleep(250);
  }
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator('.nb-editor[contenteditable="true"]').waitFor();
  await select(page, 0, "你好");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await waitForText(page, "**你好**");
  await select(page, 1, "Nǐ hǎo");
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await waitForText(page, "*Nǐ hǎo*");
  await select(page, 2, "Hello", true);
  await page.getByRole("button", { name: "Text and highlight colours" }).click();
  await page.getByRole("button", { name: "blue highlight" }).click();
  await waitForText(page, "{bg:blue}Hello{/bg}");
  // Removing an applied highlight must unwrap the coloured element, not just
  // replace its text within the old <mark>. Keep previous bold/italic intact.
  await select(page, 2, "Hello", true);
  await page.getByRole("button", { name: "Text and highlight colours" }).click();
  await page.getByRole("button", { name: "Remove selected colour" }).click();
  console.log("After highlight removal:", JSON.stringify(await page.evaluate(() => ({
    markdown: document.querySelector('[data-testid="markdown"]')?.textContent,
    html: document.querySelector('.nb-editor')?.innerHTML,
    selection: window.getSelection()?.toString(),
  }))));
  await page.waitForFunction(() => {
    const markdown = document.querySelector('[data-testid="markdown"]')?.textContent ?? "";
    const last = document.querySelector(".nb-editor p:nth-of-type(3)");
    return markdown.includes("**你好**") && markdown.includes("*Nǐ hǎo*")
      && !markdown.includes("{bg:blue}") && last?.textContent === "Hello"
      && last?.querySelector("mark") === null;
  }, null, { timeout: 6000 });
  await page.locator(".nb-editor").click();
  await page.keyboard.press("Control+z");
  await waitForText(page, "{bg:blue}Hello{/bg}");
  await page.keyboard.press("Control+y");
  await page.waitForFunction(() => !(document.querySelector('[data-testid="markdown"]')?.textContent ?? "").includes("{bg:blue}"));

  // Tables must be real editable grids and round-trip to the persisted Markdown.
  const tablePage = await context.newPage();
  await tablePage.goto(url);
  await tablePage.locator('.nb-editor[contenteditable="true"]').waitFor();
  await tablePage.getByRole("button", { name: "Insert table" }).click();
  await tablePage.getByRole("button", { name: /Study reference/ }).click();
  assert.equal(await tablePage.locator('.nb-editor table[data-table-style="study"]').count(), 1, "Study layout was not inserted");
  assert.equal(await tablePage.locator('.nb-editor table thead th').count(), 5, "Study layout should have five columns");
  await waitForText(tablePage, "{table:study}");
  await tablePage.locator('.nb-editor table tbody tr:first-child td:first-child').click();
  await tablePage.keyboard.type("Nominativ");
  await waitForText(tablePage, "Nominativ");
  await tablePage.keyboard.press("Tab");
  assert.equal(await tablePage.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const cell = node instanceof Element ? node.closest("td") : node?.parentElement?.closest("td");
    return cell?.cellIndex;
  }), 1, "Tab should move to the next table cell");
  await tablePage.getByRole("button", { name: "Insert table" }).click();
  await tablePage.getByRole("button", { name: /Comparison/ }).click();
  assert.equal(await tablePage.locator('.nb-editor table[data-table-style="striped"]').count(), 1, "Restyling a table should not duplicate it");
  await waitForText(tablePage, "{table:striped}");
  await tablePage.close();
  await context.close();

  const touch = await browser.newContext({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true });
  const tablet = await touch.newPage();
  await tablet.goto(url);
  await tablet.locator('.nb-editor[contenteditable="true"]').waitFor();
  await select(tablet, 0, "你好");
  await tablet.getByRole("button", { name: "Bold", exact: true }).tap();
  await waitForText(tablet, "**你好**");
  await select(tablet, 2, "Hello", true);
  await tablet.getByRole("button", { name: "Text and highlight colours" }).tap();
  await tablet.getByRole("button", { name: "blue text" }).tap();
  await waitForText(tablet, "{color:blue}Hello{/color}");
  await touch.close();
  console.log("RichEditor: desktop and touch formatting, including full-line colour, passed.");
} finally {
  await browser.close();
  server.kill("SIGTERM");
  rmSync(dir, { recursive: true, force: true });
}
