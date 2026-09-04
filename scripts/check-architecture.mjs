import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../src/lib/heuresis.ts", import.meta.url), "utf8");
const capture = readFileSync(new URL("../src/components/CaptureView.tsx", import.meta.url), "utf8");

const required = ["heuresis_collections", "heuresis_packs", "heuresis_card_types", "heuresis_cards"];
for (const table of required) {
  if (!data.includes(table)) throw new Error(`Missing canonical Heuresis table: ${table}`);
}

if (data.includes("knowledge_entries") || capture.includes("knowledge_entries")) {
  throw new Error("Standalone Capture must not depend on Personal OS knowledge_entries.");
}

if (!data.includes('.from("heuresis_cards")') || !data.includes(".insert({")) {
  throw new Error("Capture must create cards directly in heuresis_cards.");
}

console.log("Heuresis architecture check passed.");
