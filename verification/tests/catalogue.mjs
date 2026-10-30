// Catalogue (independent publications) — browser scenarios against the local
// PostgreSQL + PostgREST + storage harness. Each scenario restores the showcase
// database (which has Notebook notes but no Catalogue publications).
//   node tests/catalogue.mjs              (all scenarios)
//   node tests/catalogue.mjs overflow     (scenarios whose name contains "overflow")
// Screenshots: screenshots/catalogue/. Exported PDFs: screenshots/catalogue/*.pdf
// PDF text checks use poppler's pdftotext/pdfinfo when installed (skipped otherwise).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { check, launch, signIn, sql } from "./lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = `${here}screenshots/catalogue`;
mkdirSync(SHOTS, { recursive: true });
const only = process.argv[2] ?? "";
const USER = "11111111-1111-4111-8111-111111111111";
const NOTE_A2 = "e0000000-0000-4000-8000-0000000000a2"; // 以前 / 以后 (showcase note)
const PDF_TOOLS = spawnSync("pdftotext", ["-v"]).status === 0;

function restore() {
  execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });
  rmSync(`${here}storage`, { recursive: true, force: true });
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

/** A small RGB PNG, generated here so the suite needs no image files. */
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
// A landscape picture with a dark disc right of centre (so crops are visible).
const PICTURE = png(600, 400, (x, y) => ((x - 420) ** 2 + (y - 200) ** 2 < 80 ** 2 ? [52, 38, 30] : y % 40 < 20 ? [196, 170, 132] : [150, 118, 90]));

async function articles() {
  const json = await sql(`select coalesce(json_agg(a order by created_at), '[]') from (select id, title, subtitle, status, source_kind, source_note_id, typography_preset, colour_preset, subject_id, volume_id, volume_order, pages, deleted_at, created_at from catalogue_articles) a`);
  return JSON.parse(json);
}
const blocksOf = (article) => article.pages.flatMap((page) => page.blocks);
const allText = (article) => blocksOf(article).map((block) => [block.text, block.content, block.intro, block.caption, block.attribution].filter(Boolean).join(" ")).join(" ");

async function openCatalogue(page) {
  await page.click('.hw-sections button:has-text("Catalogue")');
  await page.mouse.move(1000, 600);
  await page.waitForSelector(".ct-library", { timeout: 20000 });
}
async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector(".ct-save")?.textContent === "Saved", null, { timeout: 15000 });
}
async function createBlank(page) {
  await page.click("button.ct-create");
  await page.click('.ct-choice:has-text("Blank Article")');
  await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 20000 });
  await page.waitForTimeout(400);
}
async function typeInto(page, selector, text) {
  const target = page.locator(selector).first();
  await target.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}
async function exportPdf(page, name) {
  const download = page.waitForEvent("download", { timeout: 90000 });
  await page.locator('.ct-bar-button:has-text("Export PDF")').click();
  const file = await download;
  const path = `${SHOTS}/${name}.pdf`;
  await file.saveAs(path);
  await page.waitForSelector(".ct-export-result");
  return path;
}
function pdfText(path) { return execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }); }
function pdfInfo(path) { return execFileSync("pdfinfo", [path], { encoding: "utf8" }); }

/** Paragraph lines left alone at the top or foot of a page (widows and orphans), on the pages shown. */
async function lonelyLines(page, scope) {
  return page.evaluate((selector) => {
    const lines = (element) => element.getBoundingClientRect().height / ((parseFloat(getComputedStyle(element).lineHeight) || 20) * (element.closest(".ap-page").getBoundingClientRect().width / element.closest(".ap-page").offsetWidth));
    const found = [];
    for (const item of document.querySelectorAll(`${selector} .ap-text.is-continued .ap-text-body > p:first-child`)) if (lines(item) < 1.6) found.push(`top: ${item.textContent.slice(0, 40)}`);
    for (const item of document.querySelectorAll(`${selector} .ap-text.runs-on .ap-text-body > p:last-child`)) if (lines(item) < 1.6) found.push(`foot: ${item.textContent.slice(-40)}`);
    return found;
  }, scope);
}

/**
 * Compares the position of every word in the PDF with the same word on the page in
 * the reader (the same component the designer uses). Only words that occur once on a
 * page are compared, so a match can never be a different occurrence. Returns, per
 * axis, the share of words within the tolerance (CSS px at 100 %).
 */
async function compareWithPdf(page, path) {
  const dom = await page.evaluate(() => [...document.querySelectorAll(".ct-reader .ap-page")].map((pageElement) => {
    const box = pageElement.getBoundingClientRect();
    const scale = box.width / pageElement.offsetWidth;
    const words = [];
    const walker = document.createTreeWalker(pageElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const match of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getClientRects()[0];
        if (rect) words.push({ text: match[0], x: (rect.left - box.left) / scale, y: (rect.top - box.top) / scale });
      }
    }
    return words;
  }));
  const PX = (210 / 25.4 * 96) / 595.275591;
  const results = { compared: 0, xWithin: 0, yWithin: 0, worstX: 0 };
  dom.forEach((words, index) => {
    const html = execFileSync("pdftotext", ["-bbox-layout", "-f", String(index + 1), "-l", String(index + 1), path, "-"], { encoding: "utf8" });
    const pdfWords = [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)<\/word>/g)]
      .map((m) => ({ text: m[3].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"), x: Number(m[1]) * PX, y: Number(m[2]) * PX }));
    const key = (word) => word.text.toLocaleLowerCase();
    const counts = (list) => list.reduce((map, word) => map.set(key(word), (map.get(key(word)) ?? 0) + 1), new Map());
    const domCounts = counts(words), pdfCounts = counts(pdfWords);
    const pairs = pdfWords.filter((word) => pdfCounts.get(key(word)) === 1 && domCounts.get(key(word)) === 1 && key(word).length > 2)
      .map((word) => [word, words.find((other) => key(other) === key(word))]);
    if (!pairs.length) return;
    const offsets = pairs.map(([a, b]) => a.y - b.y).sort((p, q) => p - q);
    const median = offsets[Math.floor(offsets.length / 2)];
    for (const [a, b] of pairs) {
      results.compared += 1;
      const dx = Math.abs(a.x - b.x);
      results.worstX = Math.max(results.worstX, dx);
      if (dx <= 1.5) results.xWithin += 1;
      if (Math.abs(a.y - b.y - median) <= 1.5) results.yWithin += 1;
    }
  });
  return results;
}

const COMMONS = {
  batchcomplete: true,
  continue: { gsroffset: 2, continue: "gsroffset||" },
  query: { pages: [
    { pageid: 101, ns: 6, title: "File:Varusschlacht Kalkriese reconstruction.jpg", index: 1, imageinfo: [{
      size: 912345, width: 1600, height: 1067, thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Varus.jpg/480px-Varus.jpg",
      thumbwidth: 480, thumbheight: 320, url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Varus.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Varusschlacht_Kalkriese_reconstruction.jpg", mime: "image/jpeg",
      extmetadata: {
        ObjectName: { value: "Kalkriese reconstruction" },
        ImageDescription: { value: "<p>Reconstructed rampart at <b>Kalkriese</b>.</p>" },
        Artist: { value: "<a href=\"//commons.wikimedia.org/wiki/User:Example\">A. Photographer</a>" },
        LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
        AttributionRequired: { value: "true" }, UsageTerms: { value: "Creative Commons Attribution-Share Alike 4.0" },
      } }] },
    { pageid: 102, ns: 6, title: "File:Unlicensed scan.jpg", index: 2, imageinfo: [{
      width: 800, height: 600, thumburl: "https://upload.wikimedia.org/x.jpg", url: "https://upload.wikimedia.org/x.jpg", mime: "image/jpeg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Unlicensed_scan.jpg", extmetadata: {} }] },
  ] },
};

const scenarios = {
  async "empty catalogue although the Notebook has notes"(page) {
    const notes = Number(await sql(`select count(*) from knowledge_records where user_id='${USER}' and deleted_at is null`));
    check(notes > 5, `the Notebook has ${notes} notes`);
    await openCatalogue(page);
    await page.waitForTimeout(500);
    await shot(page, "01-empty-library");
    const text = await page.locator(".ct-library").innerText();
    check(/Catalogue/.test(text) && /Your collection of articles, essays and illustrated works\./.test(text), "title and the one-line description are shown");
    check(await page.locator("button.ct-create").count() === 1, "one Create Article action");
    check(await page.locator(".ct-card").count() === 0, "no publication cards");
    const subjects = (await sql(`select string_agg(name, '|') from knowledge_subjects where user_id='${USER}'`)).split("|").filter(Boolean);
    check(subjects.every((name) => !text.includes(name)), "no Notebook subjects are mirrored");
    check(!/Personal encyclopaedia|Knowledge at hand|Explore by subject|Recently added/i.test(text), "no generic filler text from the old view");
    check((await articles()).length === 0, "no Catalogue rows were created by opening it");
  },

  async "blank article opens an A4 designer and saves"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await shot(page, "02-designer-blank");
    const size = await page.locator(".ct-page-slot .ap-page").first().evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
    check(Math.abs(size.w - 793.7) < 1 && Math.abs(size.h / size.w - 297 / 210) < 0.002, `the page is laid out at A4 (${size.w}×${size.h} CSS px)`);
    await page.locator(".ct-bar-title").fill("A Blank Beginning");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "First words on an empty page.");
    await page.waitForTimeout(400);
    await waitSaved(page);
    const [row] = await articles();
    check(row?.title === "A Blank Beginning" && row.status === "draft" && row.source_kind === "blank", "saved as a draft with its title");
    check(allText(row).includes("First words on an empty page."), "the text is saved in the page");
    check(row.pages.length === 1 && blocksOf(row)[0].type === "heading" && blocksOf(row)[0].level === "opening", "one A4 page that opens with the title");
    await page.locator(".ct-bar-back").click();
    await page.waitForSelector(".ct-library .ct-card");
    check(await page.locator('.ct-shelf:has-text("Drafts") .ct-card').count() === 1, "back in the library the draft is under Drafts");
  },

  async "notebook note becomes an independent copy"(page) {
    const before = await sql(`select body || '|' || updated_at || '|' || coalesce(deleted_at::text, '') from knowledge_records where id='${NOTE_A2}'`);
    await openCatalogue(page);
    await page.click("button.ct-create");
    await page.click('.ct-choice:has-text("From Notebook")');
    await page.fill('input[aria-label="Find a note"]', "以前 / 以后");
    await page.locator('.ct-note-list button:has(strong:text-is("以前 / 以后"))').click();
    await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 20000 });
    await page.waitForTimeout(800);
    await shot(page, "03-designer-from-note");
    const [row] = await articles();
    check(row?.source_kind === "notebook" && row.source_note_id === NOTE_A2, "the article records which note it was copied from");
    check(row.status === "draft", "a converted note is never published automatically");
    check(await sql(`select body || '|' || updated_at || '|' || coalesce(deleted_at::text, '') from knowledge_records where id='${NOTE_A2}'`) === before, "the note itself is unchanged");
    check((await page.locator(".ct-notice").innerText()).includes("unchanged"), "the designer says the note is unchanged");
    const copied = allText(row);
    await sql(`update knowledge_records set body = 'REWRITTEN AFTER CONVERSION' where id='${NOTE_A2}'`);
    await sql(`update knowledge_records set deleted_at = now() where id='${NOTE_A2}'`);
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.waitForTimeout(1200);
    const [after] = await articles();
    check(allText(after) === copied && !allText(after).includes("REWRITTEN"), "editing and deleting the note does not change the article");
    await sql(`delete from knowledge_records where id='${NOTE_A2}'`);
    const [still] = await articles();
    check(still && still.deleted_at === null, "even permanently deleting the note keeps the article");
  },

  async "DOCX import keeps structure and pictures"(page) {
    await openCatalogue(page);
    await page.click("button.ct-create");
    await page.locator('.ct-layout-choice button:has-text("Text only")').click();
    const chooser = page.waitForEvent("filechooser");
    await page.click('.ct-choice:has-text("Import DOCX")');
    await (await chooser).setFiles(`${here}fixtures/catalogue-sample.docx`);
    await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 40000 });
    await page.waitForTimeout(1500);
    await shot(page, "04-designer-docx");
    const [row] = await articles();
    const blocks = blocksOf(row);
    check(row.title === "The Battle of the Teutoburg Forest" && row.subtitle.startsWith("Rome"), "title and subtitle come from the Title and Subtitle styles");
    check(blocks.some((block) => block.type === "heading" && block.text === "Prelude"), "Heading 1 becomes a section heading");
    const text = blocks.filter((block) => block.type === "text").map((block) => block.content).join("\n");
    check(/\*\*Publius Quinctilius Varus\*\*/.test(text) && /\*Germania\*/.test(text), "bold and italic are kept");
    check(/^- Muddy tracks/m.test(text) && /^1\. Night attacks/m.test(text), "bulleted and numbered lists are kept");
    check(/\| AD 9 \| Battle \|/.test(text), "the table is kept");
    const quote = blocks.find((block) => block.type === "quote");
    check(quote?.text === "Quintili Vare, legiones redde!" && /Suetonius/.test(quote.attribution), "the quotation and its attribution become a quotation block");
    const image = blocks.find((block) => block.type === "image");
    check(Boolean(image?.image?.path) && existsSync(`${here}storage/heuresis-catalogue-media/${image.image.path}`), "the embedded picture is stored in the Catalogue image bucket");
    check(image?.caption === "The Kalkriese site today (illustration).", "the Word caption is attached to the picture");
    check(/Битва/.test(text) && /条顿堡/.test(text) && /Varusschlacht/.test(text), "German, Russian and Chinese text survive");
    const notice = await page.locator(".ct-notice").innerText();
    check(/underline/i.test(notice), `unsupported formatting is named, not silently dropped (“${notice.replace(/\s+/g, " ").slice(0, 120)}”)`);
    check(row.status === "draft", "an import is never published automatically");
    check(row.pages.length >= 2, `the document is laid out on ${row.pages.length} A4 pages`);
    check(await page.locator(".ct-overflow-note").count() === 0, "no page overflows after the import");
  },

  async "pages: add, duplicate, reorder, delete"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Page Management");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Page one text.");
    await page.waitForTimeout(300);
    await page.click(".ct-add-page");
    check(await page.locator(".ct-layout-menu button").count() === 7, "Add Page offers seven page layouts");
    await page.locator('.ct-layout-menu button:has(strong:text-is("Text"))').click();
    await page.waitForTimeout(300);
    check(await page.locator(".ct-page-slot").count() === 2, "Add Page adds a second A4 page");
    const menu = async (index, item) => {
      await page.locator(".ct-page-tools").nth(index).locator(".ct-menu-trigger").click();
      await page.locator(`.ct-menu-list button:has-text("${item}")`).click();
      await page.waitForTimeout(250);
    };
    await menu(0, "Duplicate page");
    check(await page.locator(".ct-page-slot").count() === 3, "Duplicate Page copies a page");
    await waitSaved(page);
    let [row] = await articles();
    const ids = row.pages.map((p) => p.id);
    check(new Set(ids).size === 3 && allText({ pages: [row.pages[1]] }).includes("Page one text."), "the duplicate has its own id and the same content");
    await menu(2, "Move page up");
    await waitSaved(page);
    [row] = await articles();
    check(row.pages[1].id === ids[2] && row.pages[2].id === ids[1], "Move page up reorders the pages");
    await menu(1, "Delete page");
    await waitSaved(page);
    [row] = await articles();
    check(row.pages.length === 2 && !row.pages.some((p) => p.id === ids[2]), "an empty page is deleted without a question");
    await menu(1, "Delete page");
    const confirmShown = await page.locator('.ws-dialog:has-text("Delete page 2?")').count();
    check(confirmShown === 1, "deleting a page with content asks first");
    await page.locator('.ws-dialog button:has-text("Delete page")').click();
    await waitSaved(page);
    [row] = await articles();
    check(row.pages.length === 1, "the confirmed page is deleted");
    // Insert before + drag in the page list
    await menu(0, "Insert page before");
    await waitSaved(page);
    [row] = await articles();
    check(row.pages.length === 2 && row.pages[0].blocks.length === 0, "Insert page before adds an empty first page");
    const items = page.locator(".ct-rail li");
    await items.nth(1).dragTo(items.nth(0));
    await waitSaved(page);
    [row] = await articles();
    check(row.pages[0].blocks.length > 0, "dragging a page in the page list reorders it");
    await shot(page, "05-pages");
  },

  async "overflow is shown and moved to the next page"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("A Long Essay");
    // One very long paragraph between two short ones: the page must be divided inside it.
    const paragraphs = ["A short opening paragraph.", "The long walk began. " + Array.from({ length: 70 }, (_, i) => `Step ${i + 1} through the forest, while the light faded over the hills.`).join(" "), "A short closing paragraph."].join("\n");
    await page.locator(".ct-page-slot .ap-text .ap-text-body").first().click();
    await page.evaluate((text) => navigator.clipboard.writeText(text), paragraphs);
    await page.keyboard.press("Control+V");
    await page.locator(".ct-bar-title").click();
    await page.waitForSelector(".ct-overflow-note", { timeout: 10000 });
    await page.locator(".ct-overflow-note").scrollIntoViewIfNeeded();
    await shot(page, "06-overflow-detected");
    check(/past the bottom margin/.test(await page.locator(".ct-overflow-note").innerText()), "the overflow is reported, not hidden");
    await waitSaved(page);
    const [before] = await articles();
    await page.locator('.ct-overflow-note button:has-text("Move overflow to next page")').click();
    await page.waitForFunction(() => !document.querySelector(".ct-overflow-note"), null, { timeout: 20000 });
    await waitSaved(page);
    const [after] = await articles();
    check(after.pages.length >= 2, `the text now runs over ${after.pages.length} pages`);
    const words = (article) => allText(article).replace(/\s+/g, " ").trim();
    check(words(after) === words(before), "no word was lost or duplicated");
    check(blocksOf(after).some((block) => block.type === "text" && block.continued), "the paragraph continuing on the next page is marked as a continuation");
    check(await page.locator(".ct-overflow-note").count() === 0 && await page.locator(".ct-overflow-pill").count() === 0, "no page overflows any more");
    check((await lonelyLines(page, ".ct-canvas")).length === 0, "the page break leaves at least two lines of the paragraph on each page");
    await page.locator(".ct-page-slot").nth(1).scrollIntoViewIfNeeded();
    await shot(page, "06-overflow-moved");
    // A quotation added above the text pushes more onto page 2: the two parts of the
    // divided paragraph meet there and are joined again, not left as two blocks.
    await page.locator(".ct-page-tools").first().locator(".ct-add-block").click();
    await page.locator('.ct-add-menu button:has-text("Quotation")').click();
    await page.waitForFunction(() => document.activeElement?.closest?.(".ap-quote"));
    await page.keyboard.type("A quotation placed above the text.");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForSelector(".ct-overflow-note", { timeout: 10000 });
    await page.locator('.ct-overflow-note button:has-text("Move overflow to next page")').click();
    await page.waitForFunction(() => !document.querySelector(".ct-overflow-note"), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await waitSaved(page);
    const [reflowed] = await articles();
    check(reflowed.pages.every((item) => item.blocks.every((block, index) => !(block.type === "text" && block.continued && item.blocks[index - 1]?.type === "text"))),
      "parts of a divided paragraph that meet on one page are joined again");
    check(words(reflowed).replace("A quotation placed above the text. ", "") === words(before), "and still no word is lost or duplicated");
  },

  async "typography and colour presets"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Presets");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Typography test with Garamond and Caslon.");
    const style = () => page.locator(".ct-page-slot .ap-page").first().evaluate((el) => ({
      paper: getComputedStyle(el).backgroundColor,
      title: getComputedStyle(el.querySelector(".ap-title")).fontFamily,
      text: getComputedStyle(el.querySelector(".ap-text-body")).fontFamily,
      ink: getComputedStyle(el.querySelector(".ap-text-body")).color,
    }));
    let s = await style();
    check(s.paper === "rgb(245, 240, 231)" && /Libre Caslon Display/.test(s.title) && /EB Garamond/.test(s.text), "Classical on Warm by default");
    await page.selectOption('select[aria-label="Typography preset"]', "literary");
    await page.click('button[role="radio"][aria-label="Dark"]');
    await page.waitForTimeout(300);
    s = await style();
    check(s.paper === "rgb(33, 29, 27)" && s.ink === "rgb(240, 232, 221)" && /Cormorant Garamond/.test(s.title), "Literary on Dark applies to the whole page");
    await shot(page, "07-literary-dark");
    await page.selectOption('select[aria-label="Typography preset"]', "archive");
    await page.click('button[role="radio"][aria-label="White"]');
    await page.waitForTimeout(300);
    s = await style();
    check(s.paper === "rgb(255, 255, 255)" && /Noto Serif/.test(s.text), "Modern Archive on White");
    await shot(page, "07-archive-white");
    await waitSaved(page);
    const [row] = await articles();
    check(row.typography_preset === "archive" && row.colour_preset === "white", "the presets are saved with the article");
    const appTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    check(Boolean(appTheme), `the application theme (${appTheme}) is untouched by the article colours`);
  },

  async "images: upload, crop, reopen"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Illustrated");
    await page.locator(".ct-page-tools .ct-add-block").first().click();
    await page.locator('.ct-add-menu button:has-text("Image")').first().click();
    await page.locator('input[aria-label="Image file"]').setInputFiles({ name: "forest.png", mimeType: "image/png", buffer: PICTURE });
    await page.waitForSelector(".ct-crop-image img", { timeout: 20000 });
    await page.locator('.ct-chips button:has-text("Square")').click();
    await page.locator('input[aria-label="Zoom"]').fill("2");
    // Move the visible window over the dark disc (right of centre).
    const box = await page.locator(".ct-crop-image").boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await page.locator('textarea').first().fill("A clearing in the forest.");
    await shot(page, "08-image-crop");
    await page.locator('.ct-dialog button:has-text("Insert")').click();
    await page.waitForTimeout(800);
    const frame = await page.locator(".ct-page-slot .ap-image .ap-frame").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { ratio: r.width / r.height, loaded: el.querySelector("img")?.naturalWidth ?? 0 };
    });
    check(Math.abs(frame.ratio - 1) < 0.02 && frame.loaded === 600, "the image is shown in a square frame");
    await waitSaved(page);
    let [row] = await articles();
    const image = blocksOf(row).find((block) => block.type === "image");
    check(image?.image?.aspect === "1:1" && Math.abs(image.image.zoom - 2) < 0.01 && image.image.focalX > 0.6, "crop, zoom and focal point are stored (the file is untouched)");
    check(image?.caption === "A clearing in the forest.", "the caption is saved");
    check(readFileSync(`${here}storage/heuresis-catalogue-media/${image.image.path}`).equals(PICTURE), "the original file is stored unchanged (non-destructive crop)");
    // Reopen after a restart (fresh page load): the image comes back.
    await page.reload();
    await page.waitForSelector(".ct-studio .ct-page-slot .ap-image img", { timeout: 20000 });
    await page.waitForFunction(() => (document.querySelector(".ct-page-slot .ap-image img")?.naturalWidth ?? 0) > 0);
    check(true, "after reloading, the designer reopens with the image");
    // Adjust again later: the crop is editable, not baked in.
    await page.locator(".ct-page-slot .ap-image").click();
    await page.locator('.ct-block-toolbar button:has-text("Adjust image")').click();
    await page.locator('.ct-segmented button:has-text("Show whole image")').click();
    await page.locator('.ct-dialog button:has-text("Apply")').click();
    await waitSaved(page);
    [row] = await articles();
    check(blocksOf(row).find((block) => block.type === "image")?.image?.fit === "fit", "the same image can be re-framed later");
    await shot(page, "08-image-on-page");
  },

  async "image search: Wikimedia Commons with licence"(page) {
    await page.route("https://commons.wikimedia.org/w/api.php**", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("generator") === "search") return route.fulfill({ json: COMMONS, headers: { "access-control-allow-origin": "*" } });
      return route.fulfill({ json: { query: { pages: [{ title: "File:Varusschlacht Kalkriese reconstruction.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Varus.jpg", width: 1600, height: 1067, mime: "image/jpeg" }] }] } }, headers: { "access-control-allow-origin": "*" } });
    });
    await page.route("https://upload.wikimedia.org/**", (route) => route.fulfill({ body: PICTURE, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }));
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-page-tools .ct-add-block").first().click();
    await page.locator('.ct-add-menu button:has-text("Image")').first().click();
    await page.locator('.ct-segmented button:has-text("Search images")').click();
    await page.fill('input[aria-label="Search Wikimedia Commons"]', "Kalkriese");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".ct-commons-grid li");
    await page.waitForFunction(() => [...document.querySelectorAll(".ct-commons-grid img")].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 15000 });
    await shot(page, "09-image-search");
    check(await page.locator(".ct-commons-grid li").count() === 1, "results without a stated licence are not offered");
    check(/CC BY-SA 4\.0/.test(await page.locator(".ct-commons-grid").innerText()), "each result shows its licence");
    await page.locator(".ct-commons-grid button").first().click();
    check(/A\. Photographer/.test(await page.locator(".ct-commons-chosen").innerText()), "the author is shown before choosing");
    await page.locator('button:has-text("Use this image")').click();
    await page.waitForSelector(".ct-crop-image img", { timeout: 20000 });
    await page.locator('.ct-dialog button:has-text("Insert")').click();
    await page.waitForTimeout(600);
    const credit = await page.locator(".ct-page-slot .ap-credit").innerText();
    check(/A\. Photographer · CC BY-SA 4\.0 · Wikimedia Commons/.test(credit), "the credit line is printed under the image");
    await waitSaved(page);
    const [row] = await articles();
    const attribution = blocksOf(row).find((block) => block.type === "image")?.image?.attribution;
    check(attribution?.provider === "wikimedia" && attribution.licenceUrl === "https://creativecommons.org/licenses/by-sa/4.0" && /commons\.wikimedia\.org\/wiki\/File:/.test(attribution.sourceUrl), "licence, licence link and source page are stored with the image");
  },

  async "undo and redo"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Kept words.");
    await page.locator(".ct-bar-title").click();
    await page.waitForTimeout(300);
    await page.locator(".ct-page-tools .ct-add-block").first().click();
    await page.locator('.ct-add-menu button:has-text("Quotation")').click();
    await page.waitForTimeout(300);
    check(await page.locator(".ct-page-slot .ap-quote").count() === 1, "a quotation block is added");
    await page.locator(".ct-bar-title").click();
    await page.keyboard.press("Escape");
    await page.locator('.ct-bar-group button[aria-label="Undo"]').click();
    await page.waitForTimeout(300);
    check(await page.locator(".ct-page-slot .ap-quote").count() === 0, "Undo removes it");
    await page.locator('.ct-bar-group button[aria-label="Redo"]').click();
    await page.waitForTimeout(300);
    check(await page.locator(".ct-page-slot .ap-quote").count() === 1, "Redo brings it back");
    await page.locator(".ct-page-slot .ap-quote").click();
    await page.locator(".ct-bar-title").focus();
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 300);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    check(await page.locator(".ct-page-slot .ap-quote").count() === 0, "Ctrl+Z undoes too");
    check((await page.locator(".ct-page-slot .ap-text-body").first().innerText()).includes("Kept words."), "earlier text is untouched by undo");
  },

  async "drafts stay drafts; published articles are shelved and readable"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Magna Carta");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "In June 1215 the barons met King John at Runnymede.");
    await waitSaved(page);
    await page.locator(".ct-bar-back").click();
    await page.waitForSelector(".ct-card");
    check(await page.locator('.ct-shelf:has-text("Drafts") .ct-card:has-text("Magna Carta")').count() === 1, "the draft is listed under Drafts");
    check(await page.locator('.ct-shelf:not(:has-text("Drafts")) .ct-card:has-text("Magna Carta")').count() === 0, "and nowhere else");
    await page.locator('.ct-segmented button:has-text("Published")').click();
    check(await page.locator(".ct-card").count() === 0, "the Published filter does not show drafts");
    await page.locator('.ct-segmented button:has-text("All")').click();
    await page.locator('.ct-card-open:has-text("Magna Carta")').click();
    await page.waitForSelector(".ct-studio");
    check(await page.locator(".ct-studio").count() === 1, "a draft opens in the designer");
    await page.locator('.ct-bar-button:has-text("Publish")').click();
    await waitSaved(page);
    const [row] = await articles();
    check(row.status === "published", "Publish publishes");
    await page.locator(".ct-bar-back").click();
    await page.waitForSelector(".ct-card");
    check(await page.locator('.ct-shelf:has-text("Drafts")').count() === 0 && await page.locator('.ct-card:has-text("Magna Carta")').count() === 1, "the published article is on the shelf, not under Drafts");
    await page.locator('.ct-card-open:has-text("Magna Carta")').click();
    await page.waitForSelector(".ct-reader");
    check(await page.locator(".ct-reader").count() === 1, "a published article opens in the reader");
  },

  async "subjects and volumes"(page) {
    await openCatalogue(page);
    for (const title of ["The Holy Roman Empire", "Magna Carta", "The Teutoburg Forest"]) {
      await createBlank(page);
      await page.locator(".ct-bar-title").fill(title);
      await page.locator('.ct-bar-button:has-text("Publish")').click();
      await waitSaved(page);
      await page.locator(".ct-bar-back").click();
      await page.waitForSelector(".ct-library");
    }
    await page.locator('.ct-masthead .ct-menu-trigger').click();
    await page.locator('.ct-menu-list button:has-text("New subject")').click();
    await page.locator('.ct-dialog input').fill("History");
    await page.locator('.ct-dialog button:has-text("Create subject")').click();
    await page.waitForSelector('.ct-shelf-head:has-text("History")');
    await page.locator('.ct-shelf-head:has-text("History") .ct-menu-trigger').click();
    await page.locator('.ct-menu-list button:has-text("New volume")').click();
    await page.locator('.ct-volume-form input').first().fill("Empires and Kingdoms");
    check((await page.locator('.ct-volume-form input').nth(2).inputValue()) === "Volume I", "a new volume is suggested as Volume I");
    await page.locator('.ct-dialog button:has-text("Create volume")').click();
    await page.waitForSelector(".ct-volume-head");
    for (const title of ["The Teutoburg Forest", "The Holy Roman Empire", "Magna Carta"]) {
      await page.locator('.ct-volume-actions .ct-menu-trigger').click();
      await page.locator('.ct-menu-list button:has-text("Add an existing article")').click();
      await page.locator(`.ct-note-list button:has-text("${title}")`).click();
      await page.waitForTimeout(300);
    }
    await shot(page, "12-volume");
    const toc = await page.locator(".ct-toc-entry strong").allInnerTexts();
    check(toc.join("|") === "The Teutoburg Forest|The Holy Roman Empire|Magna Carta", `the table of contents keeps the order of addition (${toc.join(", ")})`);
    await page.locator('button[aria-label="Move Magna Carta up"]').click();
    await page.waitForTimeout(800);
    const reordered = await page.locator(".ct-toc-entry strong").allInnerTexts();
    check(reordered.join("|") === "The Teutoburg Forest|Magna Carta|The Holy Roman Empire", "articles can be reordered in the volume");
    const order = await sql(`select string_agg(title, '|' order by volume_order) from catalogue_articles where volume_id is not null`);
    check(order === "The Teutoburg Forest|Magna Carta|The Holy Roman Empire", "the order is saved");
    const subject = await sql(`select count(distinct subject_id) from catalogue_articles where volume_id is not null`);
    check(subject === "1", "articles added to the volume take the volume's subject");
    await page.locator(".ct-crumbs button").click();
    await page.waitForSelector('.ct-shelf:has-text("History") .ct-volume-card');
    await shot(page, "12-library-populated");
    check(await page.locator('.ct-shelf:has-text("History") .ct-volume-card:has-text("Empires and Kingdoms")').count() === 1, "the volume is shelved under its subject");
    check(await page.locator('.ct-shelf:has-text("History") > .ct-grid > .ct-card:not(.ct-volume-card)').count() === 0, "its articles are inside the volume, not loose on the shelf");
    // A subject can be deleted without losing anything.
    await page.locator('.ct-shelf-head:has-text("History") .ct-menu-trigger').click();
    await page.locator('.ct-menu-list button:has-text("Delete subject")').click();
    await page.locator('.ws-dialog button:has-text("Delete subject")').click();
    await page.waitForTimeout(600);
    check(await sql(`select count(*) from catalogue_articles`) === "3" && await sql(`select count(*) from catalogue_volumes`) === "1", "deleting a subject keeps its volume and articles");
  },

  async "reader has no editing controls"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Reading Comfort");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "A paragraph meant to be read slowly, in a quiet place.");
    await page.click(".ct-add-page");
    await page.locator('.ct-layout-menu button:has(strong:text-is("Text"))').click();
    await page.locator('.ct-bar-button:has-text("Publish")').click();
    await waitSaved(page);
    await page.locator(".ct-bar-back").click();
    await page.locator('.ct-card-open:has-text("Reading Comfort")').click();
    await page.waitForSelector(".ct-reader .ap-page");
    await page.waitForTimeout(500);
    await shot(page, "13-reader");
    check(await page.locator(".ct-reader [contenteditable]").count() === 0, "nothing is editable in the reader");
    check(await page.locator(".ct-reader .ct-block-toolbar, .ct-reader .ct-add-block, .ct-reader .ct-page-tools").count() === 0, "no editing tools");
    check(await page.locator(".ct-reader .ap-folio").count() === 2, "page numbers are shown");
    check(/1 \/ 2/.test(await page.locator(".ct-reader-page").innerText()), "the current page is shown");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    check(/2 \/ 2/.test(await page.locator(".ct-reader-page").innerText()), "the arrow key moves to the next page");
    await page.locator('.ct-zoom button[aria-label="Zoom in"]').click();
    check((await page.locator(".ct-zoom-value").innerText()).endsWith("%"), "reading zoom changes the size");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ct-library");
    check(true, "Escape returns to the library");
  },

  async "PDF export: A4, ordered, searchable, multilingual"(page) {
    await openCatalogue(page);
    await page.click("button.ct-create");
    const chooser = page.waitForEvent("filechooser");
    await page.click('.ct-choice:has-text("Import DOCX")');
    await (await chooser).setFiles(`${here}fixtures/catalogue-sample.docx`);
    await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 40000 });
    await page.waitForTimeout(1200);
    const path = await exportPdf(page, "14-teutoburg");
    await shot(page, "14-export-done");
    const [row] = await articles();
    check(/2 A4 pages|\d+ A4 pages/.test(await page.locator(".ct-export-result").innerText()), "the export reports its pages");
    const bytes = readFileSync(path);
    check(bytes.subarray(0, 5).toString() === "%PDF-", "a PDF file was saved");
    if (!PDF_TOOLS) { console.log("  · pdftotext not installed: text checks skipped"); return; }
    const info = pdfInfo(path);
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    check(pages === row.pages.length, `the PDF has the article's ${row.pages.length} pages`);
    check(/Page size:\s+595\.2\d* x 841\.8\d* pts \(A4\)/.test(info), "every page is exactly A4");
    const text = pdfText(path);
    check(text.indexOf("Prelude") < text.indexOf("Consequences") && text.indexOf("The march") < text.indexOf("Kalkriese site"), "pages and text are in order");
    check(/Publius Quinctilius Varus/.test(text) && /Varusschlacht gilt als Wendepunkt/.test(text), "English and German text is selectable");
    check(/Битва в Тевтобургском лесу/.test(text), "Russian text is selectable, with its word spaces");
    check(/条顿堡森林战役/.test(text), "Chinese text is selectable");
    check(/AUGUSTUS, ACCORDING TO SUETONIUS/.test(text), "small capitals are exported as written on the page");
    const fonts = execFileSync("pdffonts", [path], { encoding: "utf8" });
    check(/EBGaramond/.test(fonts) && /LibreCaslonDisplay/.test(fonts) && /NotoSerifSC/.test(fonts) && !/\bno\s+no\b.*Type 1/.test(fonts), "the fonts are embedded (EB Garamond, Libre Caslon Display, Noto Serif SC)");
    check(/\/Subtype\s*\/Image/.test(bytes.toString("latin1")), "the picture is embedded");
    execFileSync("pdftoppm", ["-r", "60", "-png", path, `${SHOTS}/14-teutoburg-page`]);
    check(true, "page images of the PDF are in screenshots/catalogue/14-teutoburg-page-*.png");
  },

  async "PDF export refuses to clip overflowing pages"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Too Much Text");
    await page.locator(".ct-page-slot .ap-text .ap-text-body").first().click();
    await page.evaluate((text) => navigator.clipboard.writeText(text), Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: ` + "words ".repeat(40)).join("\n"));
    await page.keyboard.press("Control+V");
    await page.locator(".ct-bar-title").click();
    await page.waitForSelector(".ct-overflow-note");
    await page.locator('.ct-bar-button:has-text("Export PDF")').click();
    await page.waitForSelector(".ct-export-problem", { timeout: 30000 });
    check(/not made, so nothing is cut off/.test(await page.locator(".ct-export-problem").innerText()), "the export explains the overflow and makes no clipped PDF");
    await page.locator('.ct-export-problem button:has-text("Move overflow")').click();
    await page.waitForFunction(() => !document.querySelector(".ct-overflow-note"), null, { timeout: 20000 });
    const path = await exportPdf(page, "14b-after-overflow");
    if (PDF_TOOLS) {
      const text = pdfText(path);
      check(/Line 1:/.test(text) && /Line 30:/.test(text), "after moving the overflow every line is in the PDF");
    }
  },

  async "offline edit is saved after reconnecting"(page, context) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Written on a Train");
    await waitSaved(page);
    await context.setOffline(true);
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Offline sentence.");
    await page.locator(".ct-bar-title").click();
    await page.waitForFunction(() => /Saved on this device/.test(document.querySelector(".ct-save")?.textContent ?? ""), null, { timeout: 15000 });
    check(true, "offline, the change is kept on this device");
    await context.setOffline(false);
    await page.waitForTimeout(7000);
    const [row] = await articles();
    check(allText(row).includes("Offline sentence."), "after reconnecting it reaches the server");
    await page.reload();
    await page.waitForSelector(".ct-studio .ap-text-body");
    check((await page.locator(".ct-page-slot .ap-text-body").first().innerText()).includes("Offline sentence."), "and is there after reloading");
  },

  async "a change made on another device is never overwritten"(page) {
    await openCatalogue(page);
    await createBlank(page);
    await page.locator(".ct-bar-title").fill("Shared essay");
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Written here first.");
    await waitSaved(page);
    const [first] = await articles();
    // Another device saves a newer version of the same article.
    await sql(`update catalogue_articles set title = 'Shared essay (edited on the tablet)' where id = '${first.id}'`);
    await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", " Then more here.");
    await page.waitForSelector(".ct-notice.is-error", { timeout: 15000 });
    check(/changed on another device/.test(await page.locator(".ct-notice.is-error").innerText()), "the designer reports the other version instead of saving over it");
    check(await sql(`select title from catalogue_articles where id = '${first.id}'`) === "Shared essay (edited on the tablet)", "the other device's version is intact");
    await page.locator('button:has-text("Save mine as a separate draft")').click();
    await page.waitForFunction(() => !document.querySelector(".ct-notice.is-error"), null, { timeout: 15000 });
    const rows = await articles();
    const mine = rows.find((row) => row.id !== first.id);
    check(rows.length === 2 && mine && allText(mine).includes("Then more here.") && mine.status === "draft", "my edits are kept as a separate draft");
    check(await page.locator(".ct-bar-title").inputValue() === "Shared essay (edited on the tablet)", "the designer then shows the other version");
  },

  async "Notebook keeps Reference notes and is unchanged"(page) {
    const topicId = await sql(`select id from knowledge_topics where user_id='${USER}' order by name limit 1`);
    await sql(`insert into knowledge_records(id,user_id,topic_id,kind,title,body,category) values ('e0000000-0000-4000-8000-00000000b001','${USER}','${topicId}','note','Roman Ideas',E'## Republic\\n\\nA mixed constitution.','reference')`);
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await openCatalogue(page);
    check(await page.locator('.ct-card:has-text("Roman Ideas")').count() === 0, "a Reference note is not shown as a Catalogue publication");
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+KeyK");
    await page.waitForSelector(".ws-palette input");
    await page.keyboard.type("Roman Ideas");
    await page.waitForTimeout(300);
    await page.locator(".ws-palette-row:not(.is-command):not(.is-cards)").first().click();
    await page.waitForSelector(".nb-doc-title");
    check((await page.locator(".nb-doc-title").innerText()) === "Roman Ideas", "the Reference note still opens in the Notebook");
    const topicName = await sql(`select name from knowledge_topics where id='${topicId}'`);
    await page.locator(".nb-crumbs button").last().click().catch(() => undefined);
    await page.waitForTimeout(300);
    await page.locator(`.nb-tree-label:has-text("${topicName}")`).first().click().catch(() => undefined);
    await page.waitForTimeout(500);
    check(await page.locator('.nb-doc-list :text("Roman Ideas")').count() === 1, "and is listed in its Notebook topic");
    check(await sql(`select count(*) from catalogue_articles`) === "0", "nothing was copied into the Catalogue");
  },
};


// ---------------------------------------------------------------------------
// Showcase: an illustrated, multilingual article using every block type,
// placed in a volume, read, and exported. Its screenshots illustrate the report.
// ---------------------------------------------------------------------------
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
const LANDSCAPE = png(900, 600, (x, y) => {
  const sky = mix([236, 214, 178], [196, 142, 98], y / 330);
  const sun = (x - 640) ** 2 + (y - 190) ** 2 < 62 ** 2;
  const ridge1 = 330 + 40 * Math.sin(x / 95) + 18 * Math.sin(x / 31);
  const ridge2 = 410 + 30 * Math.sin(x / 70 + 2) + 10 * Math.sin(x / 17);
  const ridge3 = 500 + 22 * Math.sin(x / 120 + 4);
  if (y > ridge3) return mix([58, 44, 34], [36, 28, 22], (y - ridge3) / 100);
  if (y > ridge2) return mix([104, 82, 62], [80, 62, 46], (y - ridge2) / 100);
  if (y > ridge1) return mix([150, 120, 92], [126, 100, 76], (y - ridge1) / 100);
  return sun ? [246, 226, 190] : sky;
});
const ARCHES = png(480, 720, (x, y) => {
  const stone = (x + y) % 9 < 1 ? [176, 152, 122] : [196, 172, 140];
  const column = Math.floor(x / 160);
  const cx = column * 160 + 80;
  const inArch = Math.abs(x - cx) < 52 && (y > 300 || (x - cx) ** 2 + (y - 300) ** 2 < 52 ** 2) && y < 640;
  if (y > 660) return [120, 98, 76];
  return inArch ? mix([70, 54, 42], [40, 30, 24], (y - 250) / 400) : stone;
});
const MAP = png(600, 600, (x, y) => {
  const d = Math.hypot(x - 300 + 40 * Math.sin(y / 60), y - 280 + 30 * Math.cos(x / 70));
  const river = Math.abs(y - (420 + 60 * Math.sin(x / 80))) < 6;
  if (river) return [92, 118, 132];
  if (Math.abs(d % 38 - 19) < 1.4) return [140, 104, 70];
  return mix([238, 224, 196], [214, 192, 156], d / 420);
});

function storeImage(name, bytes) {
  const path = `${USER}/showcase-${name}.png`;
  const dir = `${here}storage/heuresis-catalogue-media/${USER}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/showcase-${name}.png`, bytes);
  writeFileSync(`${dir}/showcase-${name}.png.meta.json`, JSON.stringify({ type: "image/png", size: bytes.length }));
  return path;
}
const img = (path, width, height, extra = {}) => ({ path, width, height, mime: "image/png", alt: "", aspect: "original", fit: "fill", zoom: 1, focalX: 0.5, focalY: 0.5, attribution: null, ...extra });
const id = () => crypto.randomUUID();

async function seedShowcase() {
  const landscape = storeImage("landscape", LANDSCAPE), arches = storeImage("arches", ARCHES), map = storeImage("map", MAP);
  const subject = id(), volume = id(), rich = id();
  await sql(`insert into catalogue_subjects(id, user_id, name) values ('${subject}', '${USER}', 'History')`);
  await sql(`insert into catalogue_volumes(id, user_id, subject_id, title, subtitle, edition, edition_date, cover) values ('${volume}', '${USER}', '${subject}', 'European History', 'Empires and Kingdoms', 'Volume I', '2026-10-30', $j$${JSON.stringify(img(map, 600, 600))}$j$)`);
  const T = (content, extra = {}) => ({ id: id(), type: "text", content, columns: 1, align: "justify", dropCap: false, ...extra });
  const pages = [
    { id: id(), blocks: [{ id: id(), type: "cover", kicker: "", style: "framed", image: img(landscape, 900, 600) }] },
    { id: id(), blocks: [
      { id: id(), type: "heading", level: "opening", kicker: "", text: "", intro: "In the autumn of AD 9, three legions vanished in the forests east of the Rhine. The defeat changed the map of Europe for four centuries.", align: "left" },
      T("Rome had pushed its frontier to the Elbe within a generation. Roads, markets and garrisons followed the rivers, and Germanic leaders were drawn into the orbit of the empire as allies, hostages and officers. Among them was **Arminius**, a prince of the Cherusci who had served in the Roman army and held the rank of an equestrian.\nWhen Publius Quinctilius *Varus* marched his column back towards the winter camps, Arminius reported a rising among distant tribes. Varus turned aside from the familiar road into country of hills, bogs and dense woodland.", { dropCap: true }),
      { id: id(), type: "heading", level: "section", kicker: "I", text: "The ambush", intro: "", align: "left" },
      T("For three days the legions fought in rain and mud. The column, kilometres long and burdened with baggage and families, could not form a line. Attacks came from the slopes and the trees, then withdrew.\nAt Kalkriese, between the Wiehengebirge and a great bog, the warriors had built a turf wall. The Romans were pressed into a corridor scarcely a hundred metres wide.\nVarus and his senior officers took their own lives. Of the eagles of the three legions, two were recovered only decades later.", { columns: 2 }),
    ] },
    { id: id(), blocks: [
      { id: id(), type: "image", image: img(landscape, 900, 600, { aspect: "16:9", focalY: 0.62 }), size: "full", placement: "center", bleed: true, caption: "Wooded hills north of Osnabrück, where the column was trapped.", showCredit: true },
      { id: id(), type: "quote", text: "Quintili Vare, legiones redde!", attribution: "Augustus, according to Suetonius", style: "pull" },
      T("The emperor, it was said, let his hair and beard grow for months and struck his head against the doors of the palace. The defeat ended plans for a province between the Rhine and the Elbe."),
      { id: id(), type: "divider", style: "ornament" },
      { id: id(), type: "heading", level: "section", kicker: "II", text: "Memory and languages", intro: "", align: "left" },
      T("Die Varusschlacht gilt seither als Wendepunkt der römischen Germanienpolitik. Битва в Тевтобургском лесу стала символом в немецкой истории XIX века. 条顿堡森林战役被认为是罗马扩张的转折点。"),
    ] },
    { id: id(), blocks: [
      { id: id(), type: "image-text", image: img(arches, 480, 720, { aspect: "2:3" }), side: "left", ratio: 40, content: "Excavations since 1987 have recovered more than six thousand objects: coins, armour fittings, a famous iron face mask and the remains of the turf wall.\n## What the finds show\n- the fighting moved along the wall\n- mules and wagons were abandoned\n- coins end in AD 9", caption: "Arcades of a later Roman building.", showCredit: false },
      { id: id(), type: "caption", text: "Dates follow the Julian calendar; place names are given in their modern form.", source: "Compiled from Tacitus, Annals I; Cassius Dio LVI" },
    ] },
  ];
  await sql(`insert into catalogue_articles(id, user_id, title, subtitle, author, subject_id, volume_id, volume_order, status, published_at, typography_preset, colour_preset, page_numbers, running_header, pages)
    values ('${rich}', '${USER}', 'The Battle of the Teutoburg Forest', 'How three legions were lost, and what Rome learned', 'Thomas', '${subject}', '${volume}', 0, 'published', now(), 'classical', 'warm', true, true, $j$${JSON.stringify(pages)}$j$)`);
  const simple = (title, subtitle, order, preset, colour) => sql(`insert into catalogue_articles(id, user_id, title, subtitle, subject_id, volume_id, volume_order, status, published_at, typography_preset, colour_preset, pages)
    values ('${id()}', '${USER}', '${title}', '${subtitle}', '${subject}', '${volume}', ${order}, 'published', now(), '${preset}', '${colour}', $j$${JSON.stringify([{ id: id(), blocks: [{ id: id(), type: "heading", level: "opening", kicker: "", text: "", intro: "", align: "left" }, T("A shorter essay in the same volume, to show the table of contents and the reading order.")] }])}$j$)`);
  await simple("The Holy Roman Empire", "Neither holy, nor Roman, nor an empire?", 1, "literary", "warm");
  await simple("Magna Carta", "Runnymede, June 1215", 2, "archive", "white");
  await sql(`insert into catalogue_articles(id, user_id, title, subtitle, subject_id, status, typography_preset, colour_preset, pages) values ('${id()}', '${USER}', 'Notes on Stoicism', 'A draft', null, 'draft', 'literary', 'dark', $j$${JSON.stringify([{ id: id(), blocks: [{ id: id(), type: "heading", level: "opening", kicker: "", text: "", intro: "", align: "left" }, T("Work in progress.")] }])}$j$)`);
  return { rich, volume };
}

scenarios["showcase: every block type, read and exported"] = async (page) => {
  const { rich } = await seedShowcase();
  await page.reload();
  await page.waitForSelector(".heuresis-section-sidebar");
  await openCatalogue(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/20-library-populated.png`, fullPage: true });
  check(await page.locator(".ct-volume-card").count() === 1 && await page.locator('.ct-shelf:has-text("Drafts") .ct-card').count() === 1, "the library shows the volume on its subject shelf and the draft under Drafts");
  await page.locator(".ct-volume-card .ct-card-open").click();
  await page.waitForSelector(".ct-volume-head");
  await page.waitForTimeout(600);
  await shot(page, "21-volume");
  await page.locator('.ct-volume-actions button:has-text("Read")').click();
  await page.waitForSelector(".ct-reader .ap-page");
  await page.waitForFunction(() => [...document.querySelectorAll(".ct-reader img")].every((image) => image.complete && image.naturalWidth > 0));
  await page.waitForTimeout(800);
  await shot(page, "22-reader-fit-width");
  // Whole pages: zoom out with the keyboard, then step through the article.
  for (let press = 0; press < 3; press += 1) await page.keyboard.press("-");
  const showPage = async (index, name) => {
    await page.locator(".ct-read-slot").nth(index).evaluate((slot) => slot.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);
    await shot(page, name);
  };
  await showPage(0, "23-reader-cover");
  await showPage(1, "24-reader-opening");
  await showPage(2, "24b-reader-illustrated");
  await showPage(3, "24c-reader-image-text");
  check(await page.locator(".ct-reader .ws-icon-button, .ct-reader [contenteditable='true'], .ct-reader .ct-block-toolbar").count() === 0, "the reader has no editing controls");
  const overflowNotice = await page.locator(".ct-reader .ct-notice").count();
  // Lay out properly in the designer: any page that overflows is flowed onward.
  await page.locator('.ct-bar-button:has-text("Edit")').click();
  await page.waitForSelector(".ct-studio .ct-page-slot");
  await page.waitForTimeout(1500);
  if (await page.locator(".ct-overflow-note").count()) {
    await page.locator('.ct-overflow-note button').first().click();
    await page.waitForFunction(() => !document.querySelector(".ct-overflow-note"), null, { timeout: 30000 });
  }
  check(await page.locator(".ct-overflow-note").count() === 0, `no page overflows (the reader reported ${overflowNotice ? "an overflow first" : "none"})`);
  await page.locator(".ct-page-slot").nth(1).locator(".ap-text").first().click();
  await page.waitForTimeout(400);
  await shot(page, "25-designer-opening");
  await page.locator(".ct-page-slot").nth(3).scrollIntoViewIfNeeded();
  await page.locator(".ct-page-slot").nth(3).locator(".ap-image-text").click();
  await page.waitForTimeout(400);
  await shot(page, "26-designer-image-text");
  await waitSaved(page);
  const path = await exportPdf(page, "27-showcase");
  const [row] = (await articles()).filter((article) => article.id === rich);
  if (PDF_TOOLS) {
    const info = pdfInfo(path);
    check(Number(/Pages:\s+(\d+)/.exec(info)?.[1]) === row.pages.length, `the PDF has all ${row.pages.length} pages`);
    const text = pdfText(path);
    const flat = text.replace(/\s+/g, " ").toLowerCase();
    for (const phrase of ["The Battle of the Teutoburg Forest", "Thomas", "The ambush", "Quintili Vare, legiones redde!", "Die Varusschlacht gilt seither", "Битва в Тевтобургском лесу", "条顿堡森林战役", "What the finds show", "Compiled from Tacitus"])
      check(flat.includes(phrase.toLowerCase()), `PDF text contains “${phrase}”`);
    execFileSync("pdftoppm", ["-r", "70", "-png", path, `${SHOTS}/27-showcase-pdf`]);
  }
  // Whole volume as one PDF
  await page.locator(".ct-export-result").waitFor();
  await page.locator('.ct-dialog button:has-text("Done")').click();
  if (PDF_TOOLS) {
    // Every block type, four scripts, two columns, image beside text: the PDF against the page.
    await page.locator('.ct-bar-button:has-text("Preview")').click();
    await page.waitForSelector(".ct-reader .ap-page img");
    await page.waitForTimeout(800);
    const layout = await compareWithPdf(page, path);
    check(layout.compared > 150 && layout.xWithin / layout.compared > 0.99 && layout.yWithin / layout.compared > 0.98,
      `the PDF places words where the page shows them (${layout.compared} words; ${(100 * layout.xWithin / layout.compared).toFixed(1)} % within 1.5 px across, ${(100 * layout.yWithin / layout.compared).toFixed(1)} % down; worst ${layout.worstX.toFixed(2)} px)`);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ct-reader", { state: "detached" });
  }
  await page.locator(".ct-bar-back").click();
  await page.waitForSelector(".ct-volume-head, .ct-reader");
  if (await page.locator(".ct-reader").count()) await page.keyboard.press("Escape");
  await page.waitForSelector(".ct-volume-head");
  const download = page.waitForEvent("download", { timeout: 120000 });
  await page.locator('button:has-text("Export volume PDF")').click();
  const file = await download;
  const volumePath = `${SHOTS}/28-volume.pdf`;
  await file.saveAs(volumePath);
  if (PDF_TOOLS) {
    const pages = Number(/Pages:\s+(\d+)/.exec(pdfInfo(volumePath))?.[1]);
    check(pages === 2 + row.pages.length + 2, `the volume PDF has a title page, a contents page and the three published articles (${pages} pages)`);
    const page = (n) => execFileSync("pdftotext", ["-f", String(n), "-l", String(n), "-layout", volumePath, "-"]).toString();
    check(/European History/.test(page(1)) && /Empires and Kingdoms/.test(page(1)) && /VOLUME I/i.test(page(1)), "the title page shows the volume's title, subtitle and edition");
    const contents = page(2).replace(/\s+/g, " ");
    check(/Contents/.test(contents) && /\bI The Battle of the Teutoburg Forest\b.*?\b3\b/.test(contents) && /\bII The Holy Roman Empire\b.*?\b7\b/.test(contents) && /\bIII Magna Carta\b.*?\b8\b/.test(contents),
      "the contents list each article with the page it starts on");
    check(!contents.includes("Stoicism"), "drafts are left out");
    check(/\b4\s*$/.test(page(4).trim()) && /\b7\s*$/.test(page(7).trim()), "page numbers run on through the volume");
    const text = pdfText(volumePath);
    check(text.lastIndexOf("Teutoburg") < text.lastIndexOf("Holy Roman Empire") && text.lastIndexOf("Holy Roman Empire") < text.lastIndexOf("Magna Carta"), "the articles follow in contents order");
    execFileSync("pdftoppm", ["-r", "60", "-png", "-f", "1", "-l", "2", volumePath, `${SHOTS}/28-volume-pdf`]);
  }
};

scenarios["preview shows unsaved edits and closes back into the designer"] = async (page) => {
  await openCatalogue(page);
  await createBlank(page);
  await page.locator(".ct-bar-title").fill("Preview Check");
  await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Typed a moment before previewing.");
  // No waiting for the save: Preview must show what is on screen.
  await page.locator('.ct-bar-button:has-text("Preview")').click();
  await page.waitForSelector(".ct-reader .ap-page");
  check((await page.locator(".ct-reader .ap-page").first().innerText()).includes("Typed a moment before previewing."), "the preview shows the latest words, saved or not");
  check(await page.locator(".ct-reader [contenteditable]").count() === 0 && /Preview/.test(await page.locator(".ct-reader-title").innerText()), "the preview is the reader, marked Preview");
  await page.keyboard.press("Control+Z");
  await page.waitForTimeout(300);
  check((await page.locator(".ct-reader .ap-page").first().innerText()).includes("Typed a moment"), "editing keys do nothing while previewing");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ct-reader", { state: "detached" });
  check(await page.locator(".ct-studio").count() === 1 && (await page.locator(".ct-canvas .ap-text-body").first().innerText()).includes("Typed a moment"), "closing the preview returns to the same designer");
  await waitSaved(page);
  const [row] = await articles();
  check(allText(row).includes("Typed a moment before previewing."), "and the text is saved");
};

scenarios["reopening an article right after closing it waits for the last save"] = async (page) => {
  await openCatalogue(page);
  await createBlank(page);
  await page.locator(".ct-bar-title").fill("Quick Return");
  await waitSaved(page);
  // Slow the server down so the save is still running when the article is opened again.
  await page.route("**/rest/v1/catalogue_articles**", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", "Written just before leaving.");
  await page.locator(".ct-bar-back").click();
  await page.locator('.ct-card-open:has-text("Quick Return")').click();
  check(await page.locator('.ct-busy:has-text("Saving your last changes")').count() === 1, "the designer first finishes the save still running");
  await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 20000 });
  await page.unroute("**/rest/v1/catalogue_articles**");
  await page.waitForTimeout(1200);
  check((await page.locator(".ct-canvas .ap-text-body").first().innerText()).includes("Written just before leaving."), "the reopened designer shows the last words");
  await typeInto(page, ".ct-page-slot .ap-text .ap-text-body", " And more after returning.");
  await page.waitForTimeout(500);
  await waitSaved(page);
  check(await page.locator(".ct-notice.is-error").count() === 0, "no false “changed on another device”");
  const rows = await articles();
  check(rows.length === 1 && /Written just before leaving\.\s*And more after returning\./.test(allText(rows[0])), `one article with both edits (${rows.length}: ${rows.map((row) => allText(row).slice(0, 120)).join(" | ")})`);
};

scenarios["publishing needs every word visible; empty picture frames are pointed out"] = async (page) => {
  await openCatalogue(page);
  await createBlank(page);
  await page.locator(".ct-bar-title").fill("To Be Published");
  const long = ["An opening paragraph.", "The road went on. " + Array.from({ length: 110 }, (_, i) => `Mile ${i + 1} along the coast, with the tide coming in.`).join(" ")].join("\n");
  await page.locator(".ct-page-slot .ap-text .ap-text-body").first().click();
  await page.evaluate((text) => navigator.clipboard.writeText(text), long);
  await page.keyboard.press("Control+V");
  await page.locator(".ct-bar-title").click();
  await page.waitForSelector(".ct-overflow-note", { timeout: 10000 });
  await waitSaved(page);
  await page.locator('.ct-bar-button:has-text("Publish")').click();
  await page.waitForSelector('.ws-dialog:has-text("has more than fits")');
  check(/cannot be published while content runs past/.test(await page.locator(".ws-dialog").innerText()), "publishing an overflowing page is stopped and explained");
  await page.locator('.ws-dialog button:has-text("Cancel")').click();
  await waitSaved(page);
  check((await articles())[0].status === "draft", "it stays a draft");
  // A page layout with an empty picture frame
  await page.click(".ct-add-page");
  await page.locator('.ct-layout-menu button:has(strong:text-is("Picture beside text"))').click();
  await page.waitForTimeout(500);
  const ratio = await page.locator(".ct-page-slot .ap-image-text .ap-frame.is-empty").last().evaluate((el) => { const r = el.getBoundingClientRect(); return r.width / r.height; });
  check(Math.abs(ratio - 0.8) < 0.02, `the layout proposes a tall 4:5 frame (${ratio.toFixed(2)})`);
  await shot(page, "30-layout-picture-beside");
  await page.locator('.ct-bar-button:has-text("Publish")').click();
  await page.waitForSelector('.ws-dialog:has-text("has more than fits")');
  await page.locator('.ws-dialog button:has-text("Move overflow and publish")').click();
  await page.waitForSelector('.ws-dialog:has-text("picture frame is still empty")', { timeout: 30000 });
  check(/left out when the article is read and in the PDF/.test(await page.locator(".ws-dialog").innerText()), "an empty picture frame is pointed out before publishing");
  await page.locator('.ws-dialog button:has-text("Publish now")').click();
  await waitSaved(page);
  const [row] = await articles();
  check(row.status === "published", "after moving the overflow, the article is published");
  check(await page.locator(".ct-overflow-note").count() === 0, "nothing overflows");
  const words = (article) => allText(article).replace(/\s+/g, " ");
  check(words(row).includes("Mile 110 along the coast"), "no words were lost");
  await page.locator('.ct-bar-button:has-text("Preview")').click();
  await page.waitForSelector(".ct-reader .ap-page");
  check(await page.locator(".ct-reader .ap-frame, .ct-reader .ap-add-image").count() === 0 && await page.locator(".ct-reader .ap-image-text").count() === 1, "the empty frame is not shown to readers; its text is");
};

// ---------------------------------------------------------------------------
// Acceptance: an essay from Word becomes an illustrated A4 article in
// Warm / Classical, the pictures are placed, it is published and exported.
// (A stand-in essay; run it again with your own.)
// ---------------------------------------------------------------------------
const SEA = png(1200, 900, (x, y) => {
  const horizon = 430 + 6 * Math.sin(x / 140);
  if (y < horizon) {
    const sun = (x - 820) ** 2 + (y - 300) ** 2;
    if (sun < 46 ** 2) return [248, 232, 204];
    const glow = Math.max(0, 1 - Math.sqrt(sun) / 520);
    return mix(mix([214, 196, 172], [236, 210, 176], y / horizon), [246, 222, 186], glow * 0.7);
  }
  const depth = (y - horizon) / (900 - horizon);
  const wave = Math.sin(x / (18 + depth * 40) + y / 6) * 0.5 + 0.5;
  const path = Math.abs(x - 820) < 30 + depth * 260 && wave > 0.62 ? 0.5 * (1 - depth) : 0;
  return mix(mix([70, 98, 112], [34, 52, 64], depth), [236, 214, 178], path + wave * 0.06);
});
const CHART = png(1000, 1250, (x, y) => {
  const coast = 260 + 120 * Math.sin(y / 260) + 0.18 * y;
  if (x < coast) return (x + y) % 23 < 1 ? [176, 158, 130] : [206, 190, 160];
  const t = y / 1250;
  const stream = coast + 60 + 520 * t * t;
  const d = Math.abs(x - stream + 30 * Math.sin(y / 70));
  if (d < 26) return mix([196, 120, 82], [214, 160, 112], d / 26);
  const grid = x % 125 < 1.5 || y % 125 < 1.5;
  return grid ? [150, 168, 172] : mix([196, 210, 208], [176, 194, 196], t);
});
const SHIP = png(800, 1000, (x, y) => {
  const sky = mix([228, 216, 196], [196, 176, 150], y / 640);
  const hull = y > 560 && y < 610 && x > 230 + (y - 560) * 0.8 && x < 600 - (y - 560) * 0.6;
  const mast = Math.abs(x - 410) < 4 && y > 200 && y < 565;
  const sail = (y > 230 && y < 520 && x > 418 && x < 418 + (y - 230) * 0.55) || (y > 260 && y < 520 && x < 402 && x > 402 - (y - 260) * 0.5);
  if (hull || mast) return [52, 40, 32];
  if (sail) return [238, 228, 210];
  if (y > 600) return mix([92, 110, 116], [52, 66, 74], (y - 600) / 400);
  return sky;
});

scenarios["acceptance: an essay from Word becomes an illustrated four-page article"] = async (page) => {
  await openCatalogue(page);
  await page.click("button.ct-create");
  check(await page.locator('.ct-layout-choice button[aria-checked="true"]:has-text("Illustrated")').count() === 1, "Illustrated is the default layout for conversions");
  const chooser = page.waitForEvent("filechooser");
  await page.click('.ct-choice:has-text("Import DOCX")');
  await (await chooser).setFiles(`${here}fixtures/gulf-stream.docx`);
  await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 40000 });
  await page.waitForTimeout(1500);
  check(/Illustrated layout: a cover and 2 picture frames/.test(await page.locator(".ct-notice").innerText()), "the designer says what was arranged and that you choose the pictures");
  check(await page.locator(".ct-overflow-note, .ct-overflow-pill").count() === 0, "the arranged pages fit as they are, empty frames included");
  await shot(page, "31-acceptance-arranged");
  let [row] = await articles();
  check(row.typography_preset === "classical" && row.colour_preset === "warm", "Warm / Classical by default");
  check(blocksOf(row)[0].type === "cover" && blocksOf(row).some((block) => block.type === "text" && block.dropCap), "a cover page and a drop initial");
  // Fill every frame, in order, from files (the same dialog searches Wikimedia Commons).
  const pictures = [
    { name: "atlantic-evening.png", bytes: SEA },
    { name: "current-chart.png", bytes: CHART, caption: "The current follows the coast, then turns out across the Atlantic." },
    { name: "schooner.png", bytes: SHIP, caption: "Whalers crossed the stream rather than sail against it." },
  ];
  for (const picture of pictures) {
    const frame = page.locator(".ct-page-slot .ap-add-image").first();
    await frame.scrollIntoViewIfNeeded();
    await frame.click();
    await page.locator('input[aria-label="Image file"]').setInputFiles({ name: picture.name, mimeType: "image/png", buffer: picture.bytes });
    await page.waitForSelector(".ct-crop-image img", { timeout: 20000 });
    if (picture.caption) await page.locator(".ct-dialog textarea").first().fill(picture.caption);
    await page.locator('.ct-dialog button:has-text("Insert"), .ct-dialog button:has-text("Apply")').first().click();
    await page.waitForSelector(".ct-dialog", { state: "detached" });
    await page.waitForTimeout(500);
  }
  check(await page.locator(".ct-page-slot .ap-add-image").count() === 0, "every frame holds a picture");
  await page.waitForTimeout(1000);
  check(await page.locator(".ct-overflow-note, .ct-overflow-pill").count() === 0, "pictures in their proposed proportions still fit");
  if (await page.locator(".ct-overflow-note").count()) {
    await page.locator(".ct-overflow-note button").first().click();
    await page.waitForFunction(() => !document.querySelector(".ct-overflow-note"), null, { timeout: 30000 });
  }
  await waitSaved(page);
  [row] = await articles();
  check(row.pages.length === 4, `four A4 pages (${row.pages.length})`);
  check(row.pages.every((page) => page.blocks.every((block, index) => !(block.type === "text" && block.continued && page.blocks[index - 1]?.type === "text"))),
    "no paragraph is left broken in two on the same page after reflowing");
  await page.locator('.ct-bar-button:has-text("Publish")').click();
  await waitSaved(page);
  [row] = await articles();
  check(row.status === "published", "published without warnings: nothing overflows and no frame is empty");
  for (let index = 0; index < row.pages.length; index += 1) {
    await page.locator(".ct-page-slot").nth(index).scrollIntoViewIfNeeded();
  }
  await page.locator(".ct-page-slot").nth(1).evaluate((slot) => slot.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(400);
  await shot(page, "32-acceptance-designer");
  const path = await exportPdf(page, "33-acceptance");
  if (PDF_TOOLS) {
    check(Number(/Pages:\s+(\d+)/.exec(pdfInfo(path))?.[1]) === 4, "the PDF has the four pages");
    const flat = pdfText(path).replace(/\s+/g, " ");
    for (const phrase of ["both sides of the sea it crosses.", "The Gulf Stream", "A river in the sea", "There is a river in the ocean", "Franklin's chart", "Warmth for Europe", "An uncertain future", "Whalers crossed the stream rather than sail against it."])
      check(flat.includes(phrase), `PDF text contains “${phrase}”`);
    execFileSync("pdftoppm", ["-r", "80", "-png", path, `${SHOTS}/33-acceptance-pdf`]);
    // The PDF against the layout on screen, word by word.
    await page.locator('.ct-dialog button:has-text("Done")').click();
    await page.locator('.ct-bar-button:has-text("Preview")').click();
    await page.waitForSelector(".ct-reader .ap-page img");
    await page.waitForTimeout(800);
    check((await lonelyLines(page, ".ct-reader")).length === 0, "no paragraph leaves a single line alone at the top or foot of a page");
    const layout = await compareWithPdf(page, path);
    check(layout.compared > 300 && layout.xWithin / layout.compared > 0.99 && layout.yWithin / layout.compared > 0.99,
      `the PDF places words where the page shows them (${layout.compared} words; ${(100 * layout.xWithin / layout.compared).toFixed(1)} % within 1.5 px across, ${(100 * layout.yWithin / layout.compared).toFixed(1)} % down; worst ${layout.worstX.toFixed(2)} px)`);
    await shot(page, "34-acceptance-reader");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ct-reader", { state: "detached" });
    const second = execFileSync("pdftotext", ["-f", "2", "-l", "2", path, "-"], { encoding: "utf8" });
    check(!second.includes("A river in the ocean, and what it carries") && /^\s*S\s*ailors knew/.test(second), "after the cover, the text page starts with the essay, not the title again");
  }
  // Another type size: the pages are laid out again, nothing overflows, no paragraph is left in pieces.
  for (const preset of ["literary", "archive", "classical"]) {
    await page.selectOption('select[aria-label="Typography preset"]', preset);
    await page.waitForFunction(() => document.querySelector(".ct-save")?.textContent !== "Saved", null, { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await waitSaved(page);
    const [laid] = await articles();
    const broken = laid.pages.some((item) => item.blocks.some((block, index) => block.type === "text" && block.continued && item.blocks[index - 1]?.type === "text"));
    check(laid.typography_preset === preset && await page.locator(".ct-overflow-note").count() === 0 && !broken, `${preset}: laid out again with nothing overflowing (${laid.pages.length} pages)`);
  }
};

scenarios["volume PDF: a long contents list runs over several pages"] = async (page) => {
  const subject = crypto.randomUUID(), volume = crypto.randomUUID();
  await sql(`insert into catalogue_subjects(id, user_id, name) values ('${subject}', '${USER}', 'Essays')`);
  await sql(`insert into catalogue_volumes(id, user_id, subject_id, title, edition) values ('${volume}', '${USER}', '${subject}', 'Collected Essays', 'Volume II')`);
  const count = 26;
  for (let index = 0; index < count; index += 1) {
    const pages = [{ id: crypto.randomUUID(), blocks: [{ id: crypto.randomUUID(), type: "heading", level: "opening", kicker: "", text: "", intro: "", align: "left" }] }];
    await sql(`insert into catalogue_articles(id, user_id, title, subtitle, subject_id, volume_id, volume_order, status, published_at, pages)
      values ('${crypto.randomUUID()}', '${USER}', 'Essay number ${index + 1} on a long and winding subject', 'With a subtitle that is long enough to need a second line in the contents of the volume, ${index + 1}', '${subject}', '${volume}', ${index}, 'published', now(), $j$${JSON.stringify(pages)}$j$)`);
  }
  await page.reload();
  await page.waitForSelector(".heuresis-section-sidebar");
  await openCatalogue(page);
  await page.locator(".ct-volume-card .ct-card-open").click();
  await page.waitForSelector(".ct-volume-head");
  const download = page.waitForEvent("download", { timeout: 180000 });
  await page.locator('button:has-text("Export volume PDF")').click();
  const file = await download;
  const path = `${SHOTS}/29-long-volume.pdf`;
  await file.saveAs(path);
  check(await page.locator(".ct-export-problem").count() === 0, "nothing is refused or clipped");
  if (PDF_TOOLS) {
    const pages = Number(/Pages:\s+(\d+)/.exec(pdfInfo(path))?.[1]);
    const contentsPages = pages - 1 - count;
    check(contentsPages >= 2 && contentsPages <= 5, `the contents take ${contentsPages} pages, then the ${count} essays follow`);
    const text = execFileSync("pdftotext", ["-f", "2", "-l", String(1 + contentsPages), path, "-"]).toString().replace(/\s+/g, " ");
    const listed = Array.from({ length: count }, (_, index) => text.includes(`Essay number ${index + 1} on a long`)).filter(Boolean).length;
    check(listed === count, `every essay is listed in the contents (${listed} of ${count})`);
    check(text.includes(`${1 + contentsPages + count}`), "the last essay's page number is the last page of the PDF");
    execFileSync("pdftoppm", ["-r", "50", "-png", "-f", "2", "-l", "3", path, `${SHOTS}/29-long-volume`]);
  }
};

const LAYOUTS = "phone and tablet layouts";
async function layouts() {
  restore();
  console.log(`— ${LAYOUTS}`);
  // Prepare one illustrated, published article.
  const setup = await launch({ width: 1440, height: 900 });
  await signIn(setup.page);
  await setup.context.storageState({ path: `${here}tests/state.json` });
  await openCatalogue(setup.page);
  await setup.page.click("button.ct-create");
  await setup.page.locator('.ct-layout-choice button:has-text("Text only")').click();
  const chooser = setup.page.waitForEvent("filechooser");
  await setup.page.click('.ct-choice:has-text("Import DOCX")');
  await (await chooser).setFiles(`${here}fixtures/catalogue-sample.docx`);
  await setup.page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 40000 });
  await setup.page.locator('.ct-bar-button:has-text("Publish")').click();
  await waitSaved(setup.page);
  await setup.browser.close();
  for (const [name, width, height] of [["tablet", 820, 1180], ["phone", 390, 844]]) {
    const { browser, page, errors } = await launch({ width, height, storageState: `${here}tests/state.json` });
    await page.goto(process.env.HEURESIS_URL ?? "http://localhost:1421/");
    await page.waitForSelector(".heuresis-desktop", { timeout: 20000 });
    await page.evaluate(() => { const nav = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Catalogue" && b.closest(".mobile-workspace-nav, .hw-sections")); nav?.click(); });
    await page.waitForSelector(".ct-library .ct-card", { timeout: 20000 });
    await page.waitForTimeout(600);
    await shot(page, `16-${name}-library`);
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(await wide() <= 1, `${name}: the library has no sideways scrolling`);
    await page.locator(".ct-card-open").first().click();
    await page.waitForSelector(".ct-reader .ap-page");
    await page.waitForTimeout(600);
    await shot(page, `16-${name}-reader`);
    const pageBox = await page.locator(".ct-read-slot").first().boundingBox();
    check(pageBox.width <= width && Math.abs(pageBox.height / pageBox.width - 297 / 210) < 0.01, `${name}: the reader fits the A4 page to the width`);
    await page.locator('.ct-bar-button:has-text("Edit"), .ct-bar-button[aria-label="Edit"]').first().click();
    await page.waitForSelector(".ct-studio .ct-page-slot");
    await page.waitForTimeout(800);
    await page.locator(".ct-page-slot .ap-text").first().click();
    await page.waitForTimeout(300);
    await shot(page, `16-${name}-designer`);
    check(await page.evaluate(() => { const bar = document.querySelector(".ct-studio-bar"); return bar ? bar.scrollWidth <= bar.clientWidth + 1 : false; }), `${name}: the designer's top bar fits`);
    const toolbar = await page.locator(".ct-block-toolbar").boundingBox();
    check(Boolean(toolbar) && toolbar.x >= -1 && toolbar.x + toolbar.width <= width + 1, `${name}: the block tools stay on screen`);
    check(!errors.length, `${name}: no errors (${errors.join(" | ")})`);
    await browser.close();
  }
}

for (const [name, run] of Object.entries(scenarios)) {
  if (only && !name.includes(only)) continue;
  restore();
  console.log(`— ${name}`);
  const { browser, context, page, errors } = await launch({ width: 1440, height: 900 });
  try {
    await signIn(page);
    await run(page, context);
  } catch (error) {
    check(false, `${name}: ${error.message.split("\n")[0]}`);
    await shot(page, `failure-${name.replace(/[^a-z]+/gi, "-")}`).catch(() => undefined);
  }
  const relevant = errors.filter((text) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|status of 40[04]/.test(text));
  check(!relevant.length, `no page errors (${relevant.join(" | ").slice(0, 300)})`);
  await browser.close();
}
if (!only || LAYOUTS.includes(only)) await layouts().catch((error) => check(false, `${LAYOUTS}: ${error.message.split("\n")[0]}`));
