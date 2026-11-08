import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { ReviewCorrection } from "../../lib/reviewCorrections";
import "./review-mistakes.css";

type LinkedMistake = {
  id: string; card_id: string; pack_id: string; template_id: string | null;
  miss_count: number; last_wrong_at: string;
};
type CardRow = { id: string; data: Record<string, unknown> };
type NamedRow = { id: string; title?: string; name?: string };
type Attempt = { id: string; card_id: string; template_id: string | null; event_type: string; created_at: string };
type DisplayMistake = LinkedMistake & {
  title: string; reference: string; topic: string; direction: string;
  notes: ReviewCorrection[]; attempts: Attempt[];
};

function titleOf(data: Record<string, unknown> | undefined) {
  if (!data) return "Flashcard";
  const known = ["term", "word", "front", "question", "expression", "sentence"];
  const value = known.map((key) => data[key]).find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : Object.values(data).find((item): item is string =>
    typeof item === "string" && Boolean(item.trim()) && !item.startsWith("{")) ?? "Flashcard";
}

function referenceOf(data: Record<string, unknown> | undefined) {
  const value = data?.meaning ?? data?.translation ?? data?.answer;
  return typeof value === "string" ? value : "";
}

function stamp(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Entries are materialised by Supabase only after a second wrong grade, not by the UI. */
export function ReviewMistakes() {
  const [rows, setRows] = useState<DisplayMistake[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const db = supabase;
    async function load() {
      try {
        const { data, error: loadError } = await db.from("heuresis_review_mistakes")
          .select("id,card_id,pack_id,template_id,miss_count,last_wrong_at")
          .order("last_wrong_at", { ascending: false }).limit(150);
        if (loadError) throw loadError;
        const repeated = (data ?? []) as LinkedMistake[];
        if (!repeated.length) {
          if (mounted) setRows([]);
          return;
        }
        const cardIds = [...new Set(repeated.map((row) => row.card_id))];
        const packIds = [...new Set(repeated.map((row) => row.pack_id))];
        const templateIds = [...new Set(repeated.map((row) => row.template_id).filter((id): id is string => Boolean(id)))];
        const [cards, packs, templates, notes, attempts] = await Promise.all([
          db.from("heuresis_cards").select("id,data").in("id", cardIds),
          db.from("heuresis_packs").select("id,title").in("id", packIds),
          templateIds.length ? db.from("heuresis_study_templates").select("id,name").in("id", templateIds)
            : Promise.resolve({ data: [], error: null }),
          db.from("heuresis_review_corrections")
            .select("id,card_id,template_id,grade,attempt,reference_answer,explanation,created_at")
            .in("card_id", cardIds).order("created_at", { ascending: false }).limit(1000),
          db.from("heuresis_card_events")
            .select("id,card_id,template_id,event_type,created_at")
            .in("card_id", cardIds).in("event_type", ["again", "hard"])
            .order("created_at", { ascending: false }).limit(2000),
        ]);
        for (const result of [cards, packs, templates, notes, attempts]) if (result.error) throw result.error;
        const byCard = new Map(((cards.data ?? []) as unknown as CardRow[]).map((row) => [row.id, row.data]));
        const byPack = new Map(((packs.data ?? []) as unknown as NamedRow[]).map((row) => [row.id, row.title ?? "Study"]));
        const byDirection = new Map(((templates.data ?? []) as unknown as NamedRow[]).map((row) => [row.id, row.name ?? "Review"]));
        const correctionRows = (notes.data ?? []) as unknown as ReviewCorrection[];
        const attemptRows = (attempts.data ?? []) as unknown as Attempt[];
        const matches = (row: { card_id: string; template_id: string | null }, parent: LinkedMistake) =>
          row.card_id === parent.card_id && row.template_id === parent.template_id;
        if (mounted) {
          setRows(repeated.map((row) => ({
            ...row,
            title: titleOf(byCard.get(row.card_id)),
            reference: referenceOf(byCard.get(row.card_id)),
            topic: byPack.get(row.pack_id) ?? "Study",
            direction: row.template_id ? byDirection.get(row.template_id) ?? "Review" : "Review",
            notes: correctionRows.filter((item) => matches(item, row)),
            attempts: attemptRows.filter((item) => matches(item, row)),
          })));
          setError("");
        }
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "Unable to load repeated reviews.");
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  if (!rows.length && !error) return null;
  return <section className="ml-review-automatic" aria-label="Repeated flashcard mistakes">
    <header className="ml-review-automatic-head">
      <div><span className="ml-review-kicker">From flashcards</span><h2>Repeated in review</h2>
        <p>Added after two Missed or Partial answers. Each card and direction has one history.</p></div>
      <span className="ml-review-total">{rows.length}</span>
    </header>
    {error ? <p className="ml-review-error" role="alert">Repeated review records could not be loaded. {error}</p> : null}
    <div className="ml-review-list">
      {(expanded ? rows : rows.slice(0, 8)).map((row) => <details className="ml-review-row" key={row.id}>
        <summary><span className="ml-review-icon"><RotateCcw size={15}/></span>
          <span className="ml-review-identity"><strong>{row.title}</strong>
            <small>{row.topic} · {row.direction} · {stamp(row.last_wrong_at)}</small></span>
          <span className="ml-review-times">{row.miss_count}×</span></summary>
        <div className="ml-review-detail">
          {row.reference ? <p className="ml-review-reference"><span>Reference</span>{row.reference}</p> : null}
          {row.notes.length ? <div className="ml-review-notes">
            <span>Explanations</span>
            {row.notes.map((note) => <article key={note.id}>
              <small>{stamp(note.created_at)} · {note.grade === "again" ? "Missed" : "Partial"}</small>
              <p><b>I thought</b> {note.attempt || "I could not recall it"}</p>
              <p><b>Correct</b> {note.reference_answer}</p>
              <p><b>Remember</b> {note.explanation}</p>
            </article>)}
          </div> : <p className="ml-review-empty-note">No explanation written yet. The review grades are still preserved.</p>}
          <details className="ml-review-attempts">
            <summary>Review attempts · {row.attempts.length}</summary>
            <ol>{row.attempts.map((attempt) => <li key={attempt.id}>
              <time dateTime={attempt.created_at}>{new Date(attempt.created_at).toLocaleString()}</time>
              <span>{attempt.event_type === "again" ? "Missed" : "Partial"}</span>
            </li>)}</ol>
          </details>
        </div>
      </details>)}
    </div>
    {rows.length > 8 ? <button type="button" className="ml-review-show-more"
      onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show all repeated mistakes"}</button> : null}
  </section>;
}
