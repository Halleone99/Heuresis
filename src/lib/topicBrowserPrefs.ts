import { useEffect, useState } from "react";
import type { Importance } from "./importance";

export type TopicBrowserOptions = { rememberFilters: boolean; cardManagement: boolean };
const OPTIONS_KEY = "heuresis.topic-browser.options.v1";
const CHANGE_EVENT = "heuresis:topic-browser-options";
export function readTopicBrowserOptions(): TopicBrowserOptions {
  try {
    const value = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    return { rememberFilters: value?.rememberFilters === true, cardManagement: value?.cardManagement === true };
  } catch { return { rememberFilters: false, cardManagement: false }; }
}
export function useTopicBrowserOptions() {
  const [options, setOptions] = useState(readTopicBrowserOptions);
  useEffect(() => {
    const refresh = () => setOptions(readTopicBrowserOptions());
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  function choose(key: keyof TopicBrowserOptions, value: boolean) {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify({ ...readTopicBrowserOptions(), [key]: value }));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch { /* storage optional; do not claim to have persisted */ }
  }
  return { options, choose };
}
type Status = "unsorted" | "learning" | "reference";
type Progress = "new" | "review" | "known" | "mastered";
type Detail = "again" | "production" | "stale";
type SortField = "status" | "term" | "interest" | "reviews" | "lastSeen";
export type TopicFilters = {
  query: string; statusFilters: Status[]; stateFilter: Progress | null;
  favouriteOnly: boolean; interestFilter: "all" | "none" | Importance;
  selectedTagIds: string[]; includeUntagged: boolean; allCardsExpanded: boolean;
  detailFilters: Detail[]; sortField: SortField; sortDirection: "asc" | "desc";
};
export function defaultTopicFilters(): TopicFilters {
  return { query: "", statusFilters: [], stateFilter: null, favouriteOnly: false,
    interestFilter: "all", selectedTagIds: [], includeUntagged: false, allCardsExpanded: false,
    detailFilters: [], sortField: "status", sortDirection: "asc" };
}
function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}
function manyOf<T extends string>(value: unknown, values: readonly T[]): T[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is T => values.includes(item as T)))] : [];
}
export function decodeTopicFilters(raw: string | null): TopicFilters {
  const base = defaultTopicFilters();
  try {
    const v = JSON.parse(raw ?? "{}");
    if (!v || typeof v !== "object") return base;
    const progress = ["new", "review", "known", "mastered"] as const;
    return {
      query: typeof v.query === "string" ? v.query.slice(0, 500) : "",
      statusFilters: manyOf(v.statusFilters, ["unsorted", "learning", "reference"] as const),
      stateFilter: progress.includes(v.stateFilter) ? v.stateFilter : null,
      favouriteOnly: v.favouriteOnly === true,
      interestFilter: oneOf(v.interestFilter, ["all", "none", "core", "useful", "peripheral"] as const, "all"),
      selectedTagIds: Array.isArray(v.selectedTagIds) ? [...new Set<string>(v.selectedTagIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 100))].slice(0, 200) : [],
      includeUntagged: v.includeUntagged === true, allCardsExpanded: v.allCardsExpanded === true,
      detailFilters: manyOf(v.detailFilters, ["again", "production", "stale"] as const),
      sortField: oneOf(v.sortField, ["status", "term", "interest", "reviews", "lastSeen"] as const, "status"),
      sortDirection: oneOf(v.sortDirection, ["asc", "desc"] as const, "asc"),
    };
  } catch { return base; }
}
export function readTopicFilters(packId: string): TopicFilters {
  try { return readTopicBrowserOptions().rememberFilters
    ? decodeTopicFilters(localStorage.getItem(`heuresis.topic.filters.v1:${packId}`)) : defaultTopicFilters(); }
  catch { return defaultTopicFilters(); }
}
export function saveTopicFilters(packId: string, filters: TopicFilters) {
  try { localStorage.setItem(`heuresis.topic.filters.v1:${packId}`, JSON.stringify(filters)); } catch { /* optional */ }
}
