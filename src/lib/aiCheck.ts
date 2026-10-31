import { supabase } from "./supabase";

export type ProofreadingSuggestion = {
  original: string;
  replacement: string;
  reason: string;
};

export async function checkCaptureText(text: string, language: string, context: "note" | "mistake" | "exercise", target = ""): Promise<ProofreadingSuggestion[]> {
  if (!text.trim()) throw new Error("Write something first.");
  if (text.length > 4000) throw new Error("AI can check up to 4,000 characters at once. Select a shorter passage.");
  if (!navigator.onLine) throw new Error("AI checking requires an internet connection. Your note is still saved locally.");
  if (!supabase) throw new Error("Sign in to Heuresis before checking.");
  const { data, error } = await supabase.functions.invoke("heuresis-proofread", {
    body: { text, language: language || "Unknown", context, target: target.slice(0, 120) },
  });
  if (error) {
    const response = "context" in error ? error.context : null;
    let message = "";
    if (response instanceof Response) {
      try {
        const payload = await response.clone().json();
        if (typeof payload?.error === "string") message = payload.error;
      } catch { /* no usable response body */ }
    }
    throw new Error(message || "AI checking is unavailable. Your original text has not changed.");
  }
  if (!data || !Array.isArray(data.suggestions)) throw new Error("AI returned an unexpected result. Your original text has not changed.");
  // The server performs the same validation. Never trust model-generated patch locations.
  return data.suggestions.filter((item: unknown): item is ProofreadingSuggestion => {
    if (!item || typeof item !== "object") return false;
    const entry = item as Partial<ProofreadingSuggestion>;
    return typeof entry.original === "string" && entry.original.length > 0 &&
      typeof entry.replacement === "string" && typeof entry.reason === "string" &&
      entry.original !== entry.replacement && text.split(entry.original).length === 2;
  }).slice(0, 5);
}
