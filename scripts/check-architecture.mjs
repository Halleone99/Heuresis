import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../src/lib/heuresis.ts", import.meta.url), "utf8");
const capture = readFileSync(new URL("../src/components/CaptureView.tsx", import.meta.url), "utf8");
const browse = readFileSync(new URL("../src/components/BrowseModal.tsx", import.meta.url), "utf8");
const relatedCatalogue = readFileSync(new URL("../src/components/RelatedCatalogueView.tsx", import.meta.url), "utf8");
const relatedView = readFileSync(new URL("../src/components/RelatedView.tsx", import.meta.url), "utf8");
const cosmos = readFileSync(new URL("../src/components/CosmosWindow.tsx", import.meta.url), "utf8");
const study = readFileSync(new URL("../src/lib/study.ts", import.meta.url), "utf8");
const search = readFileSync(new URL("../src/lib/search.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const knowledge = readFileSync(new URL("../src/lib/knowledgeWorkspace.ts", import.meta.url), "utf8");
const personalOs = readFileSync(new URL("../src/lib/personalOsLanguageSources.ts", import.meta.url), "utf8");
const activity = readFileSync(new URL("../src/lib/activity.ts", import.meta.url), "utf8");
const offline = readFileSync(new URL("../src/lib/offlineFetch.ts", import.meta.url), "utf8");

const required = ["heuresis_collections", "heuresis_card_types", "heuresis_cards"];
for (const table of required) {
  if (!data.includes(table)) throw new Error(`Missing canonical Heuresis data source: ${table}`);
}

if (!data.includes("heuresis_packs") && !data.includes("heuresis_pack_overview")) {
  throw new Error("Standalone Heuresis must read its canonical pack data.");
}

if (data.includes("knowledge_entries") || capture.includes("knowledge_entries")) {
  throw new Error("Standalone Capture must not depend on Personal OS knowledge_entries.");
}

if (!data.includes('.from("heuresis_cards")') || !data.includes(".insert({")) {
  throw new Error("Capture must create cards directly in heuresis_cards.");
}

if (!data.includes('.eq("role", "main")')) {
  throw new Error("Normal topic card loading must exclude role=related cards.");
}

if (!data.includes("preserveUnsupportedWorkspaceEntries")) {
  throw new Error("Desktop card-data writes must preserve workspace blocks it cannot render yet.");
}

if (browse.includes("recordEncounter") || browse.includes('event_type: "encountered"')) {
  throw new Error("Browse must not inflate review encounter statistics.");
}

if (relatedCatalogue.includes("function RelatedReview")) {
  throw new Error("Related catalogue must not ship a second untracked review engine.");
}

if (!relatedView.includes("openCosmosWindow") || !relatedView.includes("related: true")) {
  throw new Error("Pack-level Related review must launch through the canonical Cosmos engine.");
}

if (!cosmos.includes("listRelatedCards") || !cosmos.includes('relatedReview ? "related"')) {
  throw new Error("Cosmos must load related identities and record them as a Related session.");
}

if (!cosmos.includes("signHeuresisCardImages") || !cosmos.includes('type: "image"') || !cosmos.includes("signedImages[block.path]")) {
  throw new Error("Cosmos must round-trip and render shared workspace image blocks.");
}

if (!study.includes("heuresis_record_events") || !study.includes("localStorage") || !study.includes("PARK_AFTER")) {
  throw new Error("Study events must use the durable queued event path.");
}

if (search.includes('.eq("role", "main")') || !search.includes('role: "main" | "related"')) {
  throw new Error("Global search must deliberately include both main and related card identities.");
}

// --- Heuresis is a knowledge library, not a productivity dashboard. ---
const sectionIds = [...app.matchAll(/\{ id: "(overview|study|notebook|mistakes|reading|quotations|reference)", label:/g)].map((match) => match[1]);
if (sectionIds.join(",") !== "overview,study,notebook,mistakes,reading,quotations,reference") {
  throw new Error("Heuresis navigation should lead to knowledge, practice, reading and quotations, without Progress.");
}

if (knowledge.includes('.from("knowledge_entries")') || /\.from\("knowledge_entries"\)\s*\.(insert|update|upsert|delete)/.test(personalOs)) {
  throw new Error("Personal OS knowledge_entries is a legacy capture queue: Heuresis may read it, never write it.");
}

if (/language_notebooks"\)\s*\.(insert|update|upsert|delete)/.test(personalOs)) {
  throw new Error("Personal OS language_notebooks objectives are read-only in Heuresis.");
}

for (const [name, source] of [["App.tsx", app], ["activity.ts", activity], ["knowledgeWorkspace.ts", knowledge]]) {
  if (/\.from\("[^"]*anki/i.test(source) || /\.rpc\("[^"]*anki/i.test(source)) throw new Error(`${name} must not read or recreate Anki Tracker; it belongs to Personal OS Capital.`);
}

if (!knowledge.includes("crypto.randomUUID()") || !knowledge.includes("Key \\(id\\)=")) {
  throw new Error("Knowledge writes must use client ids and treat an already-stored id as success (offline replay safety).");
}

if (!offline.includes("activeFlush") || !offline.includes("isAlreadyAppliedInsert")) {
  throw new Error("Offline replay must be single-flight and must not block on inserts that already reached the server.");
}

if (!app.includes('["KeyN", "KeyM"].includes(event.code)')) {
  throw new Error("Quick capture shortcuts must use physical key codes so they work with any keyboard layout.");
}

console.log("Heuresis architecture check passed.");
