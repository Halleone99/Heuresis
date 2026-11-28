import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Load CSS in the same order as src/main.tsx, including the last-loaded
// canonical chrome file. This fixture needs no account or live database.
function cssImports(file, directory) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/^import\s+["'](\.\/[^"']+\.css)["'];?$/gm)]
    .map(match => resolve(directory, match[1]));
}
const imports = cssImports("src/main.tsx", "src");
assert.equal(imports.at(-1), resolve("src/theme/chrome.css"), "Canonical chrome should load last");
const css = [
  resolve("src/components/review-card.css"),
  ...cssImports("src/components/LearningSession.tsx", "src/components"),
  ...cssImports("src/components/SortModal.tsx", "src/components"),
  ...imports,
].map(file => readFileSync(file, "utf8")).join("\n");
const palettes = ["slate", "forest", "sepia", "neutral", "editorial", "atelier", "aegean", "marigold"];
const modes = ["light", "dark"];
const answerBadges = ["violet", "cinnabar", "indigo", "sage", "amber", "burgundy", "slate"].map(tone =>
  `<span class="lrn-answer-language" style="--lrn-language-tone: var(--c-${tone})" data-tone="${tone}">Answer language</span>`,
).join("");
const fixtures = `
<div class="heuresis-desktop" data-section="study">
  <header class="desktop-chrome">
    <button id="wordmark" class="desktop-wordmark"><span class="desktop-mark-wrap" id="mark">ε</span><span class="desktop-wordmark-name">Heuresis</span></button>
    <nav class="desktop-nav-group">
      <button id="nav" class="desktop-nav-item">Library</button>
      <button id="nav-active" class="desktop-nav-item active">Catalogue</button>
    </nav>
    <span class="desktop-spacer"></span>
    <div class="desktop-header-actions">
      <button id="sync-disabled" class="desktop-action" disabled>Syncing</button>
      <button id="search" class="desktop-action desktop-search-action"><span>Search notes</span><kbd>Ctrl K</kbd></button>
      <button id="card" class="desktop-action desktop-primary">Card</button>
      <button id="capture" class="desktop-action hw-capture-button">Capture</button>
      <details class="desktop-account-menu" open><summary><span class="desktop-account-avatar">H</span></summary>
        <div class="desktop-account-popover">
          <div class="desktop-account-identity"><span>ACCOUNT</span><strong>Account</strong></div>
          <button id="account">Settings &amp; appearance</button>
        </div>
      </details>
    </div>
  </header>
  <main class="desktop-content">
    <div class="topic-utility-actions"><button class="secondary-button" id="study-secondary">Settings</button></div>
    <div class="capture-slot"><textarea id="capture-field" placeholder="Chinese / Pinyin / English"></textarea></div>
    <div class="capture-foot-actions"><button id="disabled-capture" disabled>Add another</button></div>
    <button id="disabled-primary" class="primary-button" disabled>Unavailable</button>
    <button id="disabled-browse" class="browse-start-button" disabled>Start</button>
  </main>
</div>`;

// Convert RGB(A) computed colours to RGBA channels.
function parse(value) {
  const input = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(input)) return [...input.slice(1).match(/../g).map((v) => parseInt(v, 16)), 1];
  const colorSrgb = input.match(/^color\(srgb\s+([^)]+)\)$/);
  if (colorSrgb) {
    const [channels, alpha = "1"] = colorSrgb[1].split("/");
    const parts = channels.trim().split(/\s+/).map(Number);
    assert.equal(parts.length, 3, "Unexpected srgb: " + input);
    return [...parts.map((n) => Math.max(0, Math.min(255, n * 255))), Number(alpha.trim())];
  }
  const match = input.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)$/i);
  assert.ok(match, "Unexpected browser-computed colour: " + value);
  return [+match[1], +match[2], +match[3], match[4] === undefined ? 1 : +match[4]];
}
function composite(foreground, background) {
  const a = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    ...[0, 1, 2].map((i) => (foreground[i] * foreground[3] + background[i] * background[3] * (1 - foreground[3])) / a),
    a,
  ];
}
function luminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
const studyFixtures = `
<div class="sort-backdrop"><section class="sort-modal sort-modal--session study21 study21--new">
  <div class="sort-session-stage"><article id="new-card" class="sort-card">New cards</article></div>
</section></div>
<main class="cosmos-shell study21 study21--review" data-mode="review">
  <div class="cosmos-work cosmos-review-columns"><article id="review-card" class="cosmos-card">Review</article></div>
</main>`;

const classicDetailsFixture = `
<div class="sort-backdrop"><section class="sort-modal sort-modal--session sort-modal--editing">
  <header class="sort-topbar">New cards</header>
  <div class="sort-session-stage">
    <div id="sort-language-details" class="sort-editing-tools sort-editing-tools--left is-open">
      <button class="sort-panel-close" aria-label="Close Language details">×</button>
      <h2 class="sort-panel-title">Language</h2>
    </div>
    <div id="sort-knowledge-details" class="sort-editing-tools sort-editing-tools--right is-open">
      <button class="sort-panel-close" aria-label="Close Knowledge details">×</button>
      <h2 class="sort-panel-title">Knowledge</h2>
    </div>
    <article class="sort-card">迟到</article>
  </div>
</section></div>`;

const study21UndoFixture = `
<div class="sort-backdrop"><section class="sort-modal sort-modal--session study21 study21--new"
  style="--study21-pad-left:42px; --study21-pad-right:42px; --study21-centre-width:calc(100% - 84px)">
  <header class="sort-topbar">
    <div class="sort-new-heading"><span class="sort-stage-chip">● New</span><strong>Chinese</strong></div>
    <div class="study21-top-centre"><span>2 / 10</span><i></i><button>Later</button><button>Discard</button></div>
    <div class="sort-topbar-actions"><button>Details</button></div>
  </header>
  <div class="sort-new-undo" role="status"><span>${"我学过这个。".repeat(20)} left for later</span><button>Undo</button></div>
  <div class="sort-session-stage">
    <article class="sort-card">Next card</article>
    <div class="study21-new-dock"><div class="study21-destination"><button>Learn</button><button>Review</button></div></div>
  </div>
</section></div>`;

const interfaceFixtures = `
<div class="heuresis-desktop" data-sidebar="rail" data-section="study">
  <span class="page-wallpaper" id="test-photo" style="--wallpaper-image: linear-gradient(#12556c, #252c51); --wallpaper-opacity: .7; --wallpaper-veil: .2; --wallpaper-blur: 0px; --wallpaper-position: center; --wallpaper-fit: cover"></span>
  <header class="desktop-chrome"><button class="desktop-nav-item active" id="design-nav">Study</button></header>
  <div class="heuresis-workspace-layout">
    <aside class="heuresis-section-sidebar"><nav class="hw-sections"><button class="active" id="design-side">Study</button></nav></aside>
    <main class="desktop-content">
      <div class="intelligent-library-head"><h1 id="design-title">Study</h1></div>
      <div class="study-workspace">
        <section class="study-home" id="design-study">Study progress</section>
        <div class="library-desk study-desk"><section class="study-desk-feature">Collection</section><button class="study-desk-mini">Other collection</button></div>
      </div>
      <section class="nb-home-subject" id="design-note">Notebook</section>
      <section class="ct-collection-card" id="design-catalogue">Catalogue</section>
    </main>
  </div>
</div>`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 880 }, reducedMotion: "reduce" });
  mkdirSync("test-output/appearance", { recursive: true });
  for (const palette of palettes) for (const mode of modes) {
    await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}"><head><meta charset="UTF-8"><style>${css}</style></head><body>${fixtures}</body></html>`);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    for (const id of ["mark", "nav", "nav-active", "search", "card", "capture", "account", "sync-disabled", "disabled-capture", "disabled-primary", "disabled-browse"]) {
      const result = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const fg = getComputedStyle(el).color;
        const layers = [];
        for (let current = el; current; current = current.parentElement) {
          layers.push(getComputedStyle(current).backgroundColor);
        }
        // Start with the computed page colour; composite surfaces from root to text.
        const pageColor = getComputedStyle(document.documentElement).getPropertyValue("--ws-page").trim();
        const fallback = document.createElement("span");
        fallback.style.color = pageColor;
        document.body.append(fallback);
        const pageRgb = getComputedStyle(fallback).color;
        fallback.remove();
        return { foreground: fg, layers: layers.reverse(), pageRgb };
      }, id);
      let bg = parse(result.pageRgb);
      for (const layer of result.layers) {
        const next = parse(layer);
        if (next[3] > 0) bg = composite(next, bg);
      }
      const fg = composite(parse(result.foreground), bg);
      const actual = contrast(fg, bg);
      assert.ok(actual >= 4.5, `${palette}/${mode} #${id}: text contrast ${actual.toFixed(2)}:1 < 4.5:1; fg ${result.foreground}, bg ${JSON.stringify(bg)}, layers ${JSON.stringify(result.layers)}`);
    }
    // Browser's actual input placeholder, not just the declared colour token.
    const placeholder = await page.evaluate(() => {
      const el = document.getElementById("capture-field");
      return {
        fg: getComputedStyle(el, "::placeholder").color,
        bg: getComputedStyle(el).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--ws-surface"),
      };
    });
    const placeholderBackground = parse(placeholder.bg)[3] > .99 ? parse(placeholder.bg) : parse(placeholder.surface);
    assert.ok(contrast(parse(placeholder.fg), placeholderBackground) >= 4.5, `${palette}/${mode}: capture placeholder too faint`);
    await page.screenshot({ path: `test-output/appearance/${palette}-${mode}.png`, fullPage: true });
  }
  for (const palette of palettes) for (const mode of modes) {
    await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}"><head><style>${css}</style></head><body><div class="lrn"><main class="lrn-stage"><div class="lrn-prompt-meta">${answerBadges}</div></main></div></body></html>`);
    const face = parse(await page.locator(".lrn").evaluate(el => getComputedStyle(el).backgroundColor));
    const badges = await page.locator(".lrn-answer-language").evaluateAll(elements => elements.map(el => {
      const style = getComputedStyle(el);
      return { tone: el.dataset.tone, foreground: style.color, background: style.backgroundColor };
    }));
    for (const badge of badges) {
      const background = composite(parse(badge.background), face);
      assert.ok(contrast(parse(badge.foreground), background) >= 4.5, `${palette}/${mode}: ${badge.tone} language badge contrast`);
    }
  }
  for (const palette of palettes) for (const mode of modes) {
    await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}"><head><style>${css}</style></head><body>${studyFixtures}</body></html>`);
    const expected = palette === "slate" && mode === "dark"
      ? [0, 0, 0, 0]
      : parse(await page.locator("html").evaluate(root => getComputedStyle(root).getPropertyValue("--ws-card")));
    for (const card of ["#new-card", "#review-card"]) {
      const background = await page.locator(card).evaluate(el => getComputedStyle(el).backgroundColor);
      assert.deepEqual(parse(background), expected, `${palette}/${mode} ${card} uses its theme surface`);
    }
  }
  for (const mode of modes) for (const palette of ["aegean", "marigold"]) {
    for (const [design, cardRadius] of [["aperture", "20px"], ["forma", "7px"], ["studio", "12px"]]) {
      await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}" data-design="${design}"><head><style>${css}</style></head><body>${interfaceFixtures}</body></html>`);
      for (const id of ["design-study", "design-note", "design-catalogue"]) {
        assert.equal(await page.locator("#" + id).evaluate(el => getComputedStyle(el).borderRadius), cardRadius,
          `${design}/${mode} ${id} uses the workspace design`);
      }
      assert.match(await page.locator("#design-title").evaluate(el => getComputedStyle(el).fontFamily), /^Inter/);
      const nav = await page.locator("#design-nav").evaluate(el => {
        const header = getComputedStyle(el.parentElement);
        return {
          ink: getComputedStyle(el).color,
          surface: getComputedStyle(el).backgroundColor,
          header: header.backgroundColor,
        };
      });
      const background = composite(parse(nav.surface), parse(nav.header));
      assert.ok(contrast(parse(nav.ink), background) >= 4.5, `${design}/${palette}/${mode} navigation contrast`);
    }
  }
  for (const mode of modes) {
    const wallpaper = new Set();
    for (const palette of palettes) {
      await page.setContent(`<!doctype html><html data-theme="${mode}" data-palette="${palette}"><head><style>${css}</style></head><body>${interfaceFixtures}</body></html>`);
      wallpaper.add(await page.locator("#test-photo").evaluate(el =>
        [getComputedStyle(el).backgroundColor, getComputedStyle(el, "::after").backgroundColor].join("/")));
    }
    assert.equal(wallpaper.size, 1, `${mode} theme changes leave the photo and its veil alone`);
  }

  await page.setContent(`<!doctype html><html data-theme="dark" data-palette="forest"><head><style>${css}</style></head><body>${interfaceFixtures}</body></html>`);
  const faces = await page.locator(".study-home, .study-desk-feature, .study-desk-mini")
    .evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor));
  assert.equal(new Set(faces).size, 3, "Forest has distinct dashboard, lead card and tile surfaces");

  const shell = () => page.evaluate(() => {
    const sidebar = document.querySelector(".heuresis-section-sidebar").getBoundingClientRect();
    const content = document.querySelector(".desktop-content").getBoundingClientRect();
    const chart = document.querySelector(".study-home").getBoundingClientRect();
    const desk = document.querySelector(".study-desk").getBoundingClientRect();
    const lead = document.querySelector(".study-desk-feature").getBoundingClientRect();
    return { sidebarLeft: sidebar.left, sidebarTop: sidebar.top, contentLeft: content.left,
      contentTop: content.top, chartRight: chart.right, deskLeft: desk.left, deskWidth: desk.width, leadWidth: lead.width };
  });
  const setDesign = value => page.locator("html").evaluate((root, id) => { root.dataset.design = id; }, value);
  const checks = [
    ["aperture", metrics => metrics.sidebarTop < metrics.contentTop, "places navigation above Study"],
    ["forma", metrics => metrics.chartRight <= metrics.deskLeft, "splits Study into two columns"],
    ["studio", metrics => metrics.sidebarLeft > metrics.contentLeft, "puts navigation on the right"],
  ];
  for (const [design, checkLayout, description] of checks) {
    await setDesign(design);
    const metrics = await shell();
    assert.ok(checkLayout(metrics), `${design} ${description}`);
    assert.equal(metrics.leadWidth, metrics.deskWidth, `${design} uses the available width for the lead collection`);
  }
  await page.setContent(`<!doctype html><html data-theme="dark" data-palette="slate"><head><style>${css}</style></head><body>${classicDetailsFixture}</body></html>`);
  for (const width of [1768, 1440, 1261, 1180, 981, 980, 760, 480]) {
    await page.setViewportSize({ width, height: 880 });
    const [language, card, knowledge] = await Promise.all(
      ["#sort-language-details", ".sort-card", "#sort-knowledge-details"].map(selector => page.locator(selector).boundingBox()),
    );
    assert.ok(language.x >= 0 && knowledge.x + knowledge.width <= width, `${width}px: both Details panels fit in the viewport`);
    if (width > 980) {
      assert.ok(language.x + language.width <= card.x, `${width}px: the card does not cover Language Details`);
      assert.ok(card.x + card.width <= knowledge.x, `${width}px: the card does not cover Knowledge Details`);
    }
    for (const name of ["Close Language details", "Close Knowledge details"]) {
      await page.getByRole("button", { name }).click({ trial: true, timeout: 3000 });
    }
  }
  await page.setContent(`<!doctype html><html data-theme="dark" data-palette="slate"><head><meta charset="UTF-8"><style>${css}</style></head><body>${study21UndoFixture}</body></html>`);
  for (const [width, height] of [[1440, 880], [780, 600], [779, 600], [390, 700], [320, 480]]) {
    await page.setViewportSize({ width, height });
    const [header, notice, stage] = await Promise.all(
      [".sort-topbar", ".sort-new-undo", ".sort-session-stage"].map(selector => page.locator(selector).boundingBox()),
    );
    assert.ok(header.y + header.height <= notice.y, `${width}px: the Undo notice starts below the header`);
    assert.ok(notice.y + notice.height <= stage.y, `${width}px: the Undo notice ends before the card stage`);
    assert.ok(notice.x >= 0 && notice.x + notice.width <= width, `${width}px: the Undo notice fits with a long card term`);
    for (const name of ["Later", "Discard", "Undo", "Learn", "Review"]) {
      await page.getByRole("button", { name }).click({ trial: true, timeout: 3000 });
    }
  }
  console.log("Rendered Chrome: 16 palette/mode combinations, Learn language badge contrast, Study 2.1 card surfaces and Undo layout, Classic Details layout, wallpaper fidelity and workspace layouts passed. Screenshots saved.");
} finally {
  await browser.close();
}
