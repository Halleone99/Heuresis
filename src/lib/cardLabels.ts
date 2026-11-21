import { patchCardData, type CardWithStats } from "./heuresis";

/** Additive card metadata for grammar labels; missing or invalid data means no labels. */
export function cardLabels(data: CardWithStats["data"]): string[] {
  const raw = data._labels;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string" && Boolean(s.trim())) : [];
}
export async function saveCardLabels(card: CardWithStats, labels: string[]) {
  const cleaned = [...new Set(labels.map(s => s.trim()).filter(Boolean))];
  return patchCardData(card.id, { _labels: cleaned });
}
