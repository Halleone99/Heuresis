import { supabase } from "./supabase";
import type { StudyGrade } from "./study";

export type ReviewCorrectionGrade = Extract<StudyGrade, "again" | "hard">;

export type ReviewCorrection = {
  id: string;
  card_id: string;
  template_id: string | null;
  grade: ReviewCorrectionGrade;
  attempt: string;
  reference_answer: string;
  explanation: string;
  created_at: string;
};

export async function saveReviewCorrection(input: {
  id: string;
  cardId: string;
  packId: string;
  sessionId: string;
  templateId: string | null;
  grade: ReviewCorrectionGrade;
  attempt: string;
  referenceAnswer: string;
  explanation: string;
}): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const explanation = input.explanation.trim();
  const referenceAnswer = input.referenceAnswer.trim();
  if (!explanation) throw new Error("Explain what was wrong before saving.");
  if (!referenceAnswer) throw new Error("This card has no reference answer to compare.");
  if (explanation.length > 3000 || input.attempt.length > 3000 || referenceAnswer.length > 3000) {
    throw new Error("The correction is too long (maximum 3,000 characters per field).");
  }

  // The same client-generated ID is retained if the network drops after commit,
  // so a retry cannot create a second correction for one review attempt.
  const { error } = await supabase.from("heuresis_review_corrections").insert({
    id: input.id,
    card_id: input.cardId,
    pack_id: input.packId,
    session_id: input.sessionId,
    template_id: input.templateId,
    grade: input.grade,
    attempt: input.attempt.trim(),
    reference_answer: referenceAnswer,
    explanation,
  });
  if (!error) return;
  if (error.code === "23505") {
    const check = await supabase.from("heuresis_review_corrections")
      .select("id").eq("id", input.id).maybeSingle();
    if (!check.error && check.data?.id === input.id) return;
  }
  throw error;
}

export async function loadLatestReviewCorrection(cardId: string, templateId: string | null): Promise<ReviewCorrection | null> {
  if (!supabase) return null;
  let query = supabase.from("heuresis_review_corrections")
    .select("id,card_id,template_id,grade,attempt,reference_answer,explanation,created_at")
    .eq("card_id", cardId);
  query = templateId ? query.eq("template_id", templateId) : query.is("template_id", null);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as ReviewCorrection | null) ?? null;
}
