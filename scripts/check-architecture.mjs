import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../src/lib/heuresis.ts", import.meta.url), "utf8");
const capture = readFileSync(new URL("../src/components/CaptureView.tsx", import.meta.url), "utf8");
const browse = readFileSync(new URL("../src/components/BrowseModal.tsx", import.meta.url), "utf8");
const relatedCatalogue = readFileSync(new URL("../src/components/RelatedCatalogueView.tsx", import.meta.url), "utf8");
const relatedView = readFileSync(new URL("../src/components/RelatedView.tsx", import.meta.url), "utf8");
const cosmos = readFileSync(new URL("../src/components/CosmosWindow.tsx", import.meta.url), "utf8");
const study = readFileSync(new URL("../src/lib/study.ts", import.meta.url), "utf8");
const search = readFileSync(new URL("../src/lib/search.ts", import.meta.url), "utf8");

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

if (!study.includes("heuresis_record_events") || !study.includes("localStorage") || !study.includes("PARK_AFTER")) {
  throw new Error("Study events must use the durable queued event path.");
}

if (search.includes('.eq("role", "main")') || !search.includes('role: "main" | "related"')) {
  throw new Error("Global search must deliberately include both main and related card identities.");
}

console.log("Heuresis architecture check passed.");
