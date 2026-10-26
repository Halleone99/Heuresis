# Capture: quick notes, the pen and formatted pages

Capture is one floating page with two surfaces. Each keeps its own draft, so
switching between them never loses anything.

| Surface | For | Save does |
|---|---|---|
| **Quick** | a line, a handwritten note, a card, a mistake | files it in Captures and clears the panel for the next one; the panel stays open |
| **Page** (the **Format** button) | writing a whole lesson: title, headings, lists, tables, colours, Example/Rule blocks, drawings | the first Save puts the page in Captures; after that it stays open and saves itself about 2.5 s after you stop writing, until **New page** |

**Format** carries what was just written quickly into an empty page. **Quick** returns to quick capture and leaves the page as it is.

## The pen (`HandNotePad`)

- **Tools:** pen, highlighter (it sits under the ink), stroke eraser; three sizes; five ink colours that follow light/dark mode; four highlighter colours.
- **History:** undo and redo for strokes, erasures, Clear, paper and space. Clear needs no confirmation because Undo brings it back.
- **Paper:**
  - plain, lined or squared;
  - fills the space it is given;
  - grows as you write near the bottom, or with **More space**.

  Only the part that is written on is stored.
- **Stylus:**
  - the eraser end or side button erases while the pen is selected;
  - once a stylus has been used on a device, fingers scroll instead of drawing, so a resting hand leaves no marks. The hand button switches this back.
- **Keys:** `P` / `H` / `E` choose the pen, highlighter or eraser; `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo.
- **Drawings in pages:** **Draw** in the formatting bar inserts a drawing at the cursor. Clicking a drawing opens it again, to change or remove it. The Notebook editor has the same **Draw** button, so drawings stay editable after a page is filed.

## The window

| | Desktop (Tauri) | Android APK and browser |
|---|---|---|
| Floating | its own window, kept on top (pin to release) | a panel above the app, which still works behind it |
| Move | title bar | title bar |
| Resize | corner grip | corner grip |
| Full screen | ⤢ or `F11`; `Esc` leaves it | ⤢ or `F11`; covers the header and bottom bar |
| Minimise | folds into a small bubble showing the draft | becomes a pill where the capture button was |
| Close | hides the window; the draft stays | hides the panel; the draft stays |

The panel's place and size are remembered. In full screen a page is a centred writing column.

## Storage

A drawing is still one line of the note body, `::handnote:v1:<base64 JSON>`, so every existing reader (parser, previews, search, titles) recognises it.

| | Version 1 (old panel) | Version 2 (written now) |
|---|---|---|
| Still read | yes | yes |
| Payload | `{ version: 1, strokes: [{ d, color }] }` | `{ v: 2, h, p, s: [[tool, colour, size, x0, y0, dx, dy, …]] }` |
| Coordinates | absolute | delta-encoded integers, simplified on pen-up |

About sixty handwritten Chinese characters (450 strokes) take roughly 23,000 characters, under half of a note's 50,000.

**Older builds** show a version 2 drawing as an empty sheet, but keep its data untouched when saving, so update every device together.

Page saves update the same record with the normal compare-and-swap update. If the capture was changed or deleted elsewhere, nothing is overwritten: the text stays in the panel, and the next Save keeps it as a new capture. Updates are only sent online; offline, the page waits on the device.

## Files

| File | What it holds |
|---|---|
| `src/lib/handNote.ts` | format, encoding, smoothing, simplification, eraser hit test |
| `src/components/workspace/HandNotePad.tsx` | the pad and `HandNoteDrawing` |
| `src/components/workspace/DrawingSheet.tsx` | drawing inside a page (Capture and the Notebook) |
| `src/components/workspace/QQuickCapture.tsx` | the panel: quick, page, window behaviour |
| `src/components/workspace/FloatingQuickCapture.tsx` | the desktop window: full screen, size memory, bubble |
| `src/components/workspace/capture-panel.css`, `hand-note.css` | styles |

## Checks

| Check | Covers |
|---|---|
| `scripts/check-hand-note.mjs` | format compatibility, hostile input, size, geometry |
| `scripts/check-capture-panel-browser.mjs` | about 100 checks in Chromium on the desktop, in the desktop window, and on the Android tablet in portrait and landscape, with touch and stylus input |
