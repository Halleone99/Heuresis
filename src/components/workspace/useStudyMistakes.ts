import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import type { ReviewCorrection } from "../../lib/reviewCorrections";

type LinkedMistake = {
  id: string; card_id: string; pack_id: string; template_id: string | null;
  miss_count: number; last_wrong_at: string;
};
type CardRow = { id: string; data: Record<string, unknown> };
type PackRow = { id: string; title: string; collection_id: string };
type CollectionRow = { id: string; title: string; glyph: string | null };
type TemplateRow = { id: string; name: string };
export type StudyMistake = {
  cardId: string; packId: string; title: string; reference: string;
  subject: string; glyph: string; topic: string; direction: string;
  missCount: number; lastWrongAt: string; attempt: string; explanation: string;
};

function titleOf(data: Record<string, unknown> | undefined) {
  if (!data) return "Flashcard";
  const preferred = ["term", "word", "front", "question", "expression", "sentence"];
  const found = preferred.map((key) => data[key]).find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found : Object.values(data).find((value): value is string =>
    typeof value === "string" && Boolean(value.trim()) && !value.startsWith("{")) ?? "Flashcard";
}
function referenceOf(data: Record<string, unknown> | undefined) {
  const value = data?.meaning ?? data?.translation ?? data?.answer;
  return typeof value === "string" ? value : "";
}

/** Study has its own database tables; Notebook mistakes must remain usable if this query fails. */
export function useStudyMistakes() {
  const [items, setItems] = useState<StudyMistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((number) => number + 1), []);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) {
        if (active) { setItems([]); setLoading(false); setError("Study is not connected."); }
        return;
      }
      setLoading(true);
      try {
        const db = supabase;
        const { data, error: fetchError } = await db.from("heuresis_review_mistakes")
          .select("id,card_id,pack_id,template_id,miss_count,last_wrong_at")
          .is("resolved_at", null).order("last_wrong_at", { ascending: false }).limit(150);
        if (fetchError) throw fetchError;
        const rows = (data ?? []) as LinkedMistake[];
        if (!rows.length) {
          if (active) { setItems([]); setError(""); }
          return;
        }
        const cardIds = [...new Set(rows.map((row) => row.card_id))];
        const packIds = [...new Set(rows.map((row) => row.pack_id))];
        const templateIds = [...new Set(rows.map((row) => row.template_id).filter((id): id is string => Boolean(id)))];
        const [cards, packs, templates, corrections] = await Promise.all([
          db.from("heuresis_cards").select("id,data").in("id", cardIds),
          db.from("heuresis_packs").select("id,title,collection_id").in("id", packIds),
          templateIds.length ? db.from("heuresis_study_templates").select("id,name").in("id", templateIds)
            : Promise.resolve({ data: [], error: null }),
          db.from("heuresis_review_corrections")
            .select("id,card_id,template_id,grade,attempt,reference_answer,explanation,created_at")
            .in("card_id", cardIds).order("created_at", { ascending: false }).limit(1000),
        ]);
        for (const result of [cards, packs, templates, corrections]) if (result.error) throw result.error;
        const packRows = (packs.data ?? []) as PackRow[];
        const collectionIds = [...new Set(packRows.map((pack) => pack.collection_id).filter(Boolean))];
        const collections = collectionIds.length ? await db.from("heuresis_collections")
          .select("id,title,glyph").in("id", collectionIds) : { data: [], error: null };
        if (collections.error) throw collections.error;
        const byCard = new Map(((cards.data ?? []) as CardRow[]).map((row) => [row.id, row.data]));
        const byPack = new Map(packRows.map((row) => [row.id, row]));
        const byCollection = new Map(((collections.data ?? []) as CollectionRow[]).map((row) => [row.id, row]));
        const byDirection = new Map(((templates.data ?? []) as TemplateRow[]).map((row) => [row.id, row.name]));
        const noteRows = (corrections.data ?? []) as ReviewCorrection[];
        const grouped = new Map<string, LinkedMistake[]>();
        for (const row of rows) grouped.set(row.card_id, [...(grouped.get(row.card_id) ?? []), row]);
        const next: StudyMistake[] = [...grouped].map(([cardId, directions]) => {
          const newest = [...directions].sort((a, b) => b.last_wrong_at.localeCompare(a.last_wrong_at))[0];
          const pack = byPack.get(newest.pack_id);
          const collection = pack ? byCollection.get(pack.collection_id) : undefined;
          const note = noteRows.find((item) => directions.some((row) => row.template_id === item.template_id)
            && item.card_id === cardId);
          const distinctDirections = new Set(directions.map((row) => row.template_id ?? "default"));
          return {
            cardId, packId: newest.pack_id,
            title: titleOf(byCard.get(cardId)), reference: referenceOf(byCard.get(cardId)),
            subject: collection?.title ?? "Study", glyph: collection?.glyph ?? (collection?.title ?? "S").slice(0, 1),
            topic: pack?.title ?? "Study",
            direction: distinctDirections.size > 1 ? "both directions" :
              (newest.template_id ? byDirection.get(newest.template_id) ?? "Review" : "Review"),
            missCount: directions.reduce((sum, row) => sum + row.miss_count, 0),
            lastWrongAt: newest.last_wrong_at,
            attempt: note?.attempt ?? "", explanation: note?.explanation ?? "",
          };
        }).sort((a, b) => b.lastWrongAt.localeCompare(a.lastWrongAt));
        if (active) { setItems(next); setError(""); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Study mistakes could not be loaded.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    const onFocus = () => { void load(); };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible); };
  }, [version]);
  return { items, loading, error, reload };
}
