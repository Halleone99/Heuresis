// Catalogue (editorial studio) checks: the separation from the Notebook, the data model,
// conversion, framing, licensed image search parsing, the migration and the backup.
// Browser behaviour (designer, reader, PDF) is covered by verification/tests/catalogue.mjs.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTs } from "./lib/load-ts.mjs";

const read = (path) => readFileSync(path, "utf8");
const filesIn = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]);

// ---------------------------------------------------------------- structure and separation
const app = read("src/App.tsx");
assert.match(app, /label: "Catalogue"/, "the section keeps its name");
assert.match(app, /lazy\(\(\) => import\("\.\/components\/catalogue\/CatalogueSection"\)\)/, "the Catalogue is its own lazily loaded section");
assert.match(app, /section === "reference"[\s\S]{0,200}<CatalogueSection/, "the Catalogue section renders the new studio");
for (const removed of [
  "src/components/workspace/ReferenceLibrary.tsx", "src/components/workspace/ReferenceView.tsx",
  "src/components/workspace/knowledge-catalogue.css", "src/components/workspace/reference-library.css",
  "src/lib/referenceChapters.ts",
]) assert.ok(!existsSync(removed), `the old Notebook-mirroring catalogue is removed: ${removed}`);
const sources = filesIn("src").filter((file) => /\.(tsx?|css)$/.test(file));
for (const file of sources) {
  const text = read(file);
  assert.doesNotMatch(text, /ReferenceLibrary|referenceChapters|knowledge-catalogue\.css|lit-reference-/, `${file} must not use the old catalogue`);
}
const notebook = read("src/components/workspace/NotebookView.tsx");
assert.doesNotMatch(notebook, /referenceOnly|onExitReference|category !== "reference"/, "Reference notes are ordinary Notebook notes again");
assert.doesNotMatch(read("src/components/workspace/NotebookSidebarTree.tsx"), /category !== "reference"/);

// Catalogue code may read the Notebook (to copy a note) but never writes Notebook tables.
const catalogueFiles = [...filesIn("src/components/catalogue"), ...filesIn("src/lib/catalogue")].filter((file) => /\.tsx?$/.test(file));
for (const file of catalogueFiles) {
  const text = read(file);
  assert.doesNotMatch(text, /from\(["'](knowledge_|heuresis_|capital_)/, `${file} must not touch Notebook or Study tables`);
  assert.doesNotMatch(text, /workspace\.(save|update|remove|delete|move|add|create|archive)\w*\(/, `${file} must not change Notebook records`);
  assert.doesNotMatch(text, /heuresis-card-media/, `${file} must not use the flashcard image bucket`);
}
const create = read("src/components/catalogue/CreateArticleDialog.tsx");
assert.match(create, /source_kind: "notebook", source_note_id: entry\.id/, "a converted note remembers where it came from");
assert.match(create, /The note itself is unchanged/, "the person is told the note is untouched");
assert.doesNotMatch(create + read("src/lib/catalogue/docx.ts") + read("src/lib/catalogue/convert.ts") + read("src/lib/catalogue/compositions.ts"), /status:\s*"published"|published_at:/, "new, converted and imported articles are never published automatically");
const designer = read("src/components/catalogue/ArticleDesigner.tsx");
assert.match(designer, /async function requestPublish\(\)[\s\S]{0,400}overflowingPages\(\)/, "publishing checks for overflowing pages first");
assert.doesNotMatch(designer, /onClick=\{\(\) => patchArticle\(\{ status: "published"/, "no control publishes without the checks");
assert.match(designer, /<ArticleReader articleId=\{article\.id\} preview=\{\{ article,/, "Preview shows the designer's own copy, not the last saved one");

// ---------------------------------------------------------------- migration
const migrations = readdirSync("supabase/migrations").filter((name) => name.includes("catalogue_publications"));
assert.equal(migrations.length, 1, "one Catalogue migration");
const migration = read(join("supabase/migrations", migrations[0]));
for (const table of ["catalogue_subjects", "catalogue_volumes", "catalogue_articles"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} is created idempotently`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} has row level security`);
}
assert.doesNotMatch(migration, /\b(drop table|truncate|delete from)\b[^;]*knowledge_/i, "the migration leaves Notebook tables alone");
assert.doesNotMatch(migration, /references public\.knowledge_records/i, "articles keep no foreign key to Notebook notes (copies, not links)");
assert.match(migration, /heuresis-catalogue-media/, "a separate private image bucket");
assert.match(migration, /storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/, "images are confined to the owner's folder");

// ---------------------------------------------------------------- backup
const backup = read("src/lib/localBackup.ts");
assert.match(backup, /OPTIONAL_BACKUP_TABLES = \["catalogue_subjects", "catalogue_volumes", "catalogue_articles"\]/, "Catalogue tables are in the PC backup");
assert.match(backup, /absent_optional_tables/, "a server without the migration still backs up everything else");
assert.match(read("src-tauri/src/local_backup.rs"), /"heuresis-catalogue-media"/, "the native backup accepts Catalogue images");

// ---------------------------------------------------------------- model
const model = loadTs("src/lib/catalogue/model.ts");
const article = model.blankArticle("user-1", { title: "Essay" });
assert.equal(article.status, "draft", "new articles are drafts");
assert.equal(article.typography_preset, "classical");
assert.equal(article.colour_preset, "warm");
assert.equal(article.pages.length, 1);
assert.equal(article.pages[0].blocks[0].type, "heading");
assert.equal(Math.round(model.PAGE_WIDTH_PX), 794, "A4 width at 96 dpi");
assert.equal(Math.round(model.PAGE_HEIGHT_PX), 1123, "A4 height at 96 dpi");
assert.equal(Math.round(model.PAGE_WIDTH_PT), 595, "A4 width in points");
assert.equal(Math.round(model.PAGE_HEIGHT_PT), 842, "A4 height in points");
assert.deepEqual(model.COLOUR_PRESETS.map((preset) => [preset.id, preset.paper, preset.ink, preset.accent]), [
  ["warm", "#F5F0E7", "#3B2C24", "#A47D58"], ["white", "#FFFFFF", "#252321", "#D8D6D2"], ["dark", "#211D1B", "#F0E8DD", "#B59670"],
], "the three colour presets from the specification");
assert.deepEqual(model.TYPOGRAPHY_PRESETS.map((preset) => preset.label), ["Classical", "Literary", "Modern Archive"]);

let pages = model.insertPage(article.pages, 1);
pages = model.duplicatePage(pages, pages[1].id);
assert.equal(pages.length, 3);
assert.notEqual(pages[2].id, pages[1].id, "a duplicate gets new identities");
pages = model.movePage(pages, pages[2].id, 0);
pages = model.deletePage(pages, pages[0].id);
assert.equal(pages.length, 2);
const text = { ...model.newBlock("text"), content: "One two three" };
pages = model.insertBlock(pages, pages[1].id, 0, text);
assert.equal(model.findBlock(pages, text.id).pageIndex, 1);
pages = model.moveBlockToPage(pages, text.id, -1);
assert.equal(model.findBlock(pages, text.id).pageIndex, 0, "a block moves to the previous page");
pages = model.updateBlock(pages, text.id, { columns: 2 });
assert.equal(model.findBlock(pages, text.id).block.columns, 2);
assert.equal(model.wordCount({ ...article, pages }), 3);
pages = model.removeBlock(pages, text.id);
assert.equal(model.findBlock(pages, text.id), null);
assert.equal(model.roman(4), "IV");
assert.equal(model.roman(14), "XIV");
assert.equal(model.stableJson({ b: 1, a: { d: [1, { f: 1, e: 2 }], c: undefined } }), model.stableJson({ a: { d: [1, { e: 2, f: 1 }] }, b: 1 }), "diffs ignore key order (jsonb reorders keys)");
const stored = model.normaliseArticle({ ...article, pages: [{ id: "p", blocks: [{ id: "x", type: "unknown" }, { id: "t", type: "text", content: "Hi" }] }], published_at: "2026-10-30 09:00:00+01" });
assert.equal(stored.pages[0].blocks.length, 1, "unknown block types are dropped when reading");
assert.equal(stored.published_at, "2026-10-30T08:00:00.000Z", "timestamps are normalised so saves compare equal");
assert.throws(() => model.validateArticle({ ...article, pages: Array.from({ length: 401 }, () => model.newPage()) }), /pages/i, "the page limit is enforced before saving");

// ---------------------------------------------------------------- conversion (copies, never rewrites)
const convert = loadTs("src/lib/catalogue/convert.ts");
const report = { skippedHandwriting: 0 };
const note = "# Essay\nFirst paragraph with **bold** and [[Linked note]].\n\n# The battle\nText.\n> Alea iacta est.\n> — Caesar\n\n---\n> [!example]\n> kept in the text\n";
const { blocks, subtitle } = convert.noteToBlocks("Essay", "A subtitle", note, report);
assert.equal(subtitle, "A subtitle");
assert.deepEqual(blocks.map((block) => block.type), ["heading", "text", "heading", "text", "quote", "divider", "text"]);
assert.equal(blocks[0].level, "opening", "the article opens with its title block");
assert.equal(blocks[1].content, "First paragraph with **bold** and Linked note.", "words are copied exactly; wiki links become plain text");
assert.equal(blocks[2].text, "The battle");
assert.deepEqual([blocks[4].text, blocks[4].attribution], ["Alea iacta est.", "Caesar"]);
assert.match(blocks[6].content, /\[!example\]/, "callouts stay inside the text");

// ---------------------------------------------------------------- page layouts and the illustrated arrangement
const compositions = loadTs("src/lib/catalogue/compositions.ts");
const essay = (sections) => sections.map((count, index) => `# Part ${index + 1}\n` + Array.from({ length: count }, (_, n) => `Paragraph ${n + 1} ${"word ".repeat(85).trim()}.`).join("\n")).join("\n");
const wordsOf = (blocks) => blocks.filter((block) => block.type === "text" || block.type === "image-text").map((block) => block.content).join(" ").split(/\s+/).filter(Boolean).length;
const converted = convert.noteToBlocks("Essay", "", essay([3, 3, 3, 2])).blocks;
const arranged = compositions.illustratedLayout(converted);
assert.equal(arranged.cover.type, "cover");
assert.equal(wordsOf(arranged.body), wordsOf(converted), "the illustrated arrangement keeps every word");
const frames = arranged.body.filter((block) => block.type === "image" || block.type === "image-text");
assert.ok(frames.length >= 1 && frames.length <= 3 && frames.every((block) => block.image === null && block.frame), "it adds one to three empty frames with a proposed proportion, never a picture");
assert.equal(arranged.frames, frames.length + 1, "the count includes the cover");
assert.ok(arranged.body.find((block) => block.type === "text").dropCap, "the first text gets a drop initial");
assert.equal(model.emptyPictureFrames({ pages: [{ blocks: [arranged.cover, ...arranged.body] }] }), arranged.frames, "empty frames are counted before publishing");
const short = compositions.illustratedLayout(convert.noteToBlocks("Short", "", "Only a few words here.").blocks);
assert.equal(short.frames, 1, "a short note gets only the cover frame");
assert.equal(compositions.COMPOSITIONS.length, 7, "seven page layouts");
for (const item of compositions.COMPOSITIONS) {
  const blocks = compositions.compositionBlocks(item.id);
  assert.ok(blocks.length && blocks.every((block) => !("image" in block) || block.image === null), `${item.label} starts without a picture`);
}
assert.equal(model.pageHasContent({ blocks: compositions.compositionBlocks("picture-text") }), false, "an untouched layout page can be deleted without a question");
assert.equal(model.pageHasContent({ blocks: [{ ...model.newBlock("text"), content: "Words" }] }), true);

// ---------------------------------------------------------------- non-destructive framing
const { frameGeometry, focalFromFramePoint } = loadTs("src/lib/catalogue/crop.ts");
const image = { path: "u/i.png", width: 2000, height: 1000, mime: "image/png", alt: "", aspect: "1:1", fit: "fill", zoom: 1, focalX: 0.5, focalY: 0.5, attribution: null };
assert.deepEqual(frameGeometry(image), { frameAspect: 1, left: -50, top: 0, width: 200, height: 100 }, "fill centres a wide picture in a square");
assert.equal(frameGeometry({ ...image, focalX: 0 }).left, 0, "the focal point is kept inside the frame");
assert.equal(frameGeometry({ ...image, focalX: 1 }).left, -100);
assert.deepEqual(frameGeometry({ ...image, fit: "fit" }), { frameAspect: 1, left: 0, top: 25, width: 100, height: 50 }, "fit shows the whole picture");
assert.equal(frameGeometry({ ...image, zoom: 2 }).width, 400, "zoom magnifies");
assert.deepEqual(focalFromFramePoint(image, 0.5, 0.5), { focalX: 0.5, focalY: 0.5 });

// ---------------------------------------------------------------- licensed image search
// Node has no DOMParser; this stand-in only strips tags (the browser suite uses the real one).
globalThis.DOMParser ??= class { parseFromString(html) { return { body: { textContent: html.replace(/<[^>]*>/g, "") } }; } };
const commons = loadTs("src/lib/catalogue/wikimedia.ts");
const results = commons.parseCommonsResponse({ query: { pages: [
  { title: "File:A.jpg", index: 2, imageinfo: [{ url: "https://upload.wikimedia.org/a.jpg", thumburl: "https://upload.wikimedia.org/t.jpg", width: 800, height: 600, mime: "image/jpeg", descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
    extmetadata: { Artist: { value: "<a href='x'>Ann</a>" }, LicenseShortName: { value: "CC BY 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0" } } }] },
  { title: "File:NoLicence.jpg", index: 1, imageinfo: [{ url: "https://upload.wikimedia.org/b.jpg", width: 800, height: 600, mime: "image/jpeg", extmetadata: {} }] },
  { title: "File:Sound.ogg", index: 3, imageinfo: [{ url: "https://upload.wikimedia.org/c.ogg", width: 0, height: 0, mime: "audio/ogg", extmetadata: { LicenseShortName: { value: "CC0" } } }] },
] } });
assert.equal(results.length, 1, "results without a licence, and non-images, are never offered");
assert.equal(results[0].attribution.author, "Ann", "HTML in metadata becomes plain text");
assert.equal(commons.attributionLine(results[0].attribution), "Ann · CC BY 4.0 · Wikimedia Commons");
assert.match(read("src/lib/catalogue/wikimedia.ts"), /commons\.wikimedia\.org\/w\/api\.php/, "a real provider is used");

// ---------------------------------------------------------------- page geometry, fonts, files
const presets = loadTs("src/lib/catalogue/presets.ts");
for (const preset of ["classical", "literary", "archive"]) {
  const size = presets.contentSize(preset);
  assert.ok(size.width >= 150 && size.width <= 175 && size.height >= 235 && size.height <= 260, `${preset} leaves 18–30 mm margins on A4 (${size.width} × ${size.height} mm)`);
}
const { parseUnicodeRanges } = loadTs("src/lib/catalogue/pdf/woff.ts");
assert.deepEqual(parseUnicodeRanges("U+0000-00FF, U+0131, U+4E??"), [[0, 255], [0x131, 0x131], [0x4e00, 0x4eff]]);
const { safeFileName } = loadTs("src/lib/catalogue/save.ts", { "../platform": { isAndroidRuntime: () => false } });
assert.equal(safeFileName('Battle: "Teutoburg" / AD 9'), "Battle Teutoburg AD 9.pdf");
const manifest = read("src/lib/catalogue/pdf/fontManifest.generated.ts");
for (const family of ["EB Garamond", "Cormorant Garamond", "Libre Caslon Display", "Noto Serif", "Inter", "Heuresis Catalogue SC"])
  assert.match(manifest, new RegExp(`family: "${family}"`), `${family} can be embedded in PDFs`);

console.log("Catalogue checks passed.");
