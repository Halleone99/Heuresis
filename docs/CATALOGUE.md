# Catalogue — the editorial studio

The Catalogue is a personal library of designed publications: articles, essays and
illustrated works laid out on fixed A4 pages, grouped by subject and, optionally, into
volumes. It is **independent of the Notebook**:

| | Notebook | Catalogue |
|---|---|---|
| Purpose | working knowledge: notes, lessons, Reference notes | finished, designed publications |
| Storage | `knowledge_*` tables | `catalogue_*` tables, `heuresis-catalogue-media` bucket |
| Link between them | — | only an explicit **From Notebook** action, which *copies* the text |

A Catalogue article never changes a note, and a note never changes an article. Editing,
archiving or deleting the source note leaves the article as it is (`source_note_id` is
provenance only and has no foreign key). Reference notes are ordinary Notebook notes and
are no longer shown in the Catalogue.

## Database

`supabase/migrations/20261030090000_catalogue_publications.sql` — additive, idempotent,
safe to run more than once. It creates:

* `catalogue_subjects` (name unique per person, order);
* `catalogue_volumes` (title, subtitle, edition, edition date, cover, subject, order);
* `catalogue_articles` (title, subtitle, author, subject, volume and order in it, status
  `draft | published`, typography and colour preset, page numbers, running header, library
  cover, `pages` as JSON — at most 400 pages and 2 MB — source kind/label/note id, soft delete);
* the private bucket `heuresis-catalogue-media` (images, 20 MB per file).

Every table has row-level security (owner only); clients may update only content columns,
never `id`, `user_id` or `created_at`. Removing a subject or volume leaves its articles in
place (the reference is set to empty). The migration does not read, move or alter any
Notebook data. Until it is applied, the Catalogue says that it needs the update and the
rest of the app works as before.

Saving is compare-and-swap on `updated_at`: if the same article was changed elsewhere,
the designer keeps the local edits and offers to save them as a separate draft or to open
the other version; nothing is overwritten silently. Edits made offline are queued by the existing offline layer and saved on
reconnecting. An unsaved draft is also kept on the device until it reaches the server.

## Creating an article

* **From Notebook** — copies the note's title, description (as subtitle) and text. `#`
  headings become section headings, quotations with a final `— Name` line become quotation
  blocks, `---` becomes a divider; examples, rules and tips stay inside the text as written.
  Handwritten sketches are not copied (the designer says how many). The words are not
  rewritten.
* **Blank Article** — one A4 page with the title block.
* **Import DOCX** — Word's title, subtitle, headings, paragraphs, bold/italic, lists, tables,
  quotations, captions and pictures (PNG, JPEG, GIF, WebP). The document is converted to
  HTML by mammoth, parsed inertly and copied through a whitelist; nothing from it is inserted
  as HTML. What could not be kept (underline, colours, unsupported pictures…) is listed in
  the designer.

**Layout** (for From Notebook and Import DOCX, remembered on the device):
* **Illustrated** (default) — a cover page with a picture frame, a drop initial at the
  opening, and one to three picture frames placed where the text breaks naturally (before
  a section, otherwise between paragraphs), alternating a wide picture above the text with
  a tall picture beside it. Only frames are added: every picture is chosen by the person.
* **Text only** — the text as it is.

New articles are always drafts; nothing is published automatically.

## The designer

Fixed A4 pages (210 × 297 mm, drawn at 96 CSS px per inch and only scaled for display).
**Add Page** offers seven page layouts: Text, New section, Picture above text, Picture
beside text, Full-page picture, Quotation and text, Cover. Pages can also be inserted
blank, duplicated, deleted (with confirmation when they hold words or pictures) and
reordered (rail drag or menu). Undo/redo covers typing and structure; saving is automatic.

Empty picture frames are placeholders in the designer only: they are left out when
reading and in the PDF (the text of an empty "picture beside text" is still shown).

Blocks: cover (framed, full-bleed or plain), title & introduction, section heading with
introduction, text in one or two columns (optional drop initial), image (full, wide, half,
third; left/centre/right; edge to edge), image beside text, quotation (centred or pull),
divider (ornament, rule, space), caption & source. Each block has a small set of
adjustments in a toolbar above it (docked at the bottom on phones).

When a page holds more than fits, the page is marked and **Move overflow to next page**
carries the excess forward — splitting between words, keeping headings with their text and
marking the continued paragraph — onto the next page or a new one. Parts of a divided
text that meet again on one page are joined back together whenever pages are reflowed.
Page breaks follow book rules: a paragraph is never divided so that a single line is left
alone at the foot or top of a page; a paragraph that runs on ends the page with a full,
justified line; section headings stay with their text; an empty picture frame that does
not fit at a page foot floats past the next text, as figures do (text keeps its order;
filled pictures never move). Changing the typography preset lays the pages out again.

After a **cover**, the article's opening does not repeat the title, subtitle and author;
it keeps only its introduction, if there is one.

Overflow is measured as the page will print: empty picture frames keep their space (so a
filled frame does not suddenly overflow), while empty optional fields shown only on a
selected block (for example "Attribution (optional)") do not count.

**Publishing** checks the pages first. An article whose content runs past a page margin
cannot be published until the overflow is moved (one click: "Move overflow and publish");
empty picture frames are pointed out before publishing.

**Preview** opens the reader on the designer's own copy, so it shows exactly what is on
screen whether or not it has been saved yet, and closes back into the designer. If an
article is reopened while its last save is still running, the designer waits for that
save before opening, so it never starts from an older revision.

Presets (per article): typography **Classical** (Caslon titles, Garamond text, small
capitals), **Literary**, **Modern Archive**; colour **Warm** (#F5F0E7 / #3B2C24 / #A47D58),
**White** (#FFFFFF / #252321 / #D8D6D2), **Dark** (#211D1B / #F0E8DD / #B59670). They do not
change the app's own theme.

## Images

Uploaded images go to `heuresis-catalogue-media/<user id>/` (very large pictures are
reduced to 3600 px on the long side before upload; the flashcard bucket is not used).
Framing is non-destructive: proportion, fill or fit, zoom and focal point are stored with
the block; the file is never altered and can be re-framed at any time. Caption, a
description for screen readers, and a credit (author, licence) are kept with the image.

**Search images** queries Wikimedia Commons (`commons.wikimedia.org/w/api.php`, anonymous,
CORS). Only results that state a licence are shown; author, licence, licence link and
source page are stored with the chosen image and can be printed under it. No image is
generated or inserted without the person choosing it.

## Reading, volumes, PDF

The reader shows the same pages without any editing controls (arrow keys, zoom, Esc).
Volumes have a cover, a contents list in their own order (Roman numerals), reordering, and
previous/next while reading.

**Export PDF** paints the laid-out pages into an A4 PDF with pdf-lib: real embedded,
subset fonts (selectable and searchable text in Latin, Cyrillic and Chinese), pictures at
up to 300 dpi, page numbers and running headers as on screen. Export refuses to clip: if a
page overflows or a picture is missing it says so and offers to move the overflow first.
A volume exports as one PDF: a title page (cover picture, title, subtitle, edition and date), a contents page (as many as needed) giving the page each published article starts on, then the articles in contents order with page numbers running on. Drafts are left out.

Where the file goes:

| Runtime | Result |
|---|---|
| Browser | the browser's download |
| Windows app (WebView2) | a normal download to the Downloads folder (the same mechanism as the app's other exports) |
| Android app | `HeuresisAndroidFiles.savePdf`, added to `MainActivity` by `.github/workflows/tauri-android.yml`: Downloads/Heuresis on Android 10+, the app's Documents/Heuresis folder before that. An APK built before this change says it cannot save files yet. |

## PC backup

The Windows daily backup includes the three Catalogue tables and the Catalogue image
bucket. On a server where the migration has not been applied yet, the tables are recorded
as absent and everything else is still backed up.

## Fonts

`scripts/generate-catalogue-fonts.mjs` writes
`src/lib/catalogue/pdf/fontManifest.generated.ts` from the `@fontsource` packages (EB
Garamond, Cormorant Garamond, Libre Caslon Display, Noto Serif, Inter, and Noto Serif SC
registered privately as "Heuresis Catalogue SC"). Run it again only after changing those
packages. The PDF exporter uses the WOFF files (converted to SFNT in the browser) because
fontkit cannot subset WOFF2.

## Checks

* `scripts/check-catalogue.mjs` (CI): separation from the Notebook, migration, backup,
  model operations, conversion, framing, Commons parsing, font manifest.
* `verification/tests/catalogue.mjs` (CI, browser): see `verification/README.md`.
