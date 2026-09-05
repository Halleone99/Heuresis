import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../src/lib/heuresis.ts", import.meta.url), "utf8");
const advanced = readFileSync(new URL("../src/lib/advanced.ts", import.meta.url), "utf8");
const capture = readFileSync(new URL("../src/components/CaptureView.tsx", import.meta.url), "utf8");
const browse = readFileSync(new URL("../src/components/BrowseModal.tsx", import.meta.url), "utf8");
const relatedCatalogue = readFileSync(new URL("../src/components/RelatedCatalogueView.tsx", import.meta.url), "utf8");

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

if (!advanced.includes('.eq("role", "main")')) {
  throw new Error("Global card search must deliberately preserve its role filter.");
}

if (browse.includes("recordEncounter") || browse.includes('event_type: "encountered"')) {
  throw new Error("Browse must not inflate review encounter statistics.");
}

if (relatedCatalogue.includes("function RelatedReview")) {
  throw new Error("Related catalogue must not ship a second untracked review engine.");
}

console.log("Heuresis architecture check passed.");
