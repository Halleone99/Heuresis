import type { GradeEvent } from "./knowledgeState";
import { pendingStudyGrades, type StudyGrade } from "./study";
import { supabase } from "./supabase";

const PAGE = 1000;
const MAX_PAGES = 4;
const GRADES: StudyGrade[] = ["again", "hard", "good", "easy"];

function isGrade(value: unknown): value is StudyGrade {
  return value === "again" || value === "hard" || value === "good" || value === "easy";
}

/**
 * Recent graded results for one topic (newest 4 000), plus grades still waiting on this
 * device. Returns null when no history can be read (offline without a synchronised
 * copy): recommendations then use the per-direction counts stored with each card.
 */
export async function loadGradeEvents(packId: string): Promise<GradeEvent[] | null> {
  const events: GradeEvent[] = [];
  let available = false;
  if (supabase) {
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error } = await supabase.from("heuresis_card_events")
          .select("card_id,template_id,event_type,created_at")
          .eq("pack_id", packId).in("event_type", GRADES)
          .order("created_at", { ascending: false })
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        available = true;
        const rows = (data ?? []) as Array<{ card_id?: unknown; template_id?: unknown; event_type?: unknown; created_at?: unknown }>;
        for (const row of rows) {
          // The offline copy cannot apply every filter; check again here.
          if (typeof row.card_id !== "string" || !isGrade(row.event_type) || typeof row.created_at !== "string") continue;
          const at = Date.parse(row.created_at);
          if (Number.isFinite(at)) events.push({ cardId: row.card_id, templateId: typeof row.template_id === "string" ? row.template_id : null, grade: row.event_type, at });
        }
        if (rows.length < PAGE) break;
      }
    } catch {
      // Fall through: pending local grades may still be known.
    }
  }
  const pending = pendingStudyGrades(packId);
  for (const row of pending) {
    const at = Date.parse(row.created_at);
    if (Number.isFinite(at)) events.push({ cardId: row.card_id, templateId: row.template_id, grade: row.event_type, at });
  }
  if (!available && !pending.length) return null;
  return events;
}
