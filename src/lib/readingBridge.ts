import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Same rows as Personal OS Reading. There is no second book or quotation store. */
export type ReadingStatus = "To read" | "Reading" | "Read" | "Abandoned";
export type ReadingBook = {
  id: string; title: string; author: string; status: ReadingStatus; type: string;
  importance: number; notes: string; keyIdeas: string;
  startDate: string; finishDate: string; createdAt: string;
};
export type SavedQuote = {
  id: string; text: string; readingId: string | null; attribution: string;
  page: string; createdAt: string;
};
type BookRow = {
  id: string; title: string; author: string | null; status: ReadingStatus; type: string | null;
  importance: number | null; notes: string | null; key_ideas: string | null;
  start_date: string | null; finish_date: string | null; created_at: string;
};
type QuoteRow = {
  id: string; text: string; reading_id: string | null; attribution: string | null;
  page: string | null; created_at: string;
};
export type BookDraft = {
  title: string; author: string; status: ReadingStatus; importance: number;
};
export type QuoteDraft = {
  text: string; readingId: string | null; attribution: string; page: string;
};

function client() {
  if (!supabase) throw new Error("The shared database is not configured.");
  return supabase;
}
function bookFromRow(row: BookRow): ReadingBook {
  return {
    id: row.id, title: row.title, author: row.author ?? "", status: row.status,
    type: row.type ?? "Book", importance: row.importance ?? 2,
    notes: row.notes ?? "", keyIdeas: row.key_ideas ?? "",
    startDate: row.start_date ?? "", finishDate: row.finish_date ?? "", createdAt: row.created_at,
  };
}
function quoteFromRow(row: QuoteRow): SavedQuote {
  return {
    id: row.id, text: row.text, readingId: row.reading_id,
    attribution: row.attribution ?? "", page: row.page ?? "", createdAt: row.created_at,
  };
}
const META = /<!--reading-meta:([\\s\\S]*?)-->/i;
const TIME = /<!--reading-time:([\\s\\S]*?)-->/i;
const PROGRESS = /<!--reading-progress:(\\d+)\\/(\\d+)-->/i;
function decodeMarker(notes: string, expression: RegExp): unknown {
  const match = notes.match(expression);
  if (!match) return null;
  try { return JSON.parse(decodeURIComponent(match[1])); } catch { return null; }
}
function replaceMarker(notes: string, expression: RegExp, name: string, value: unknown) {
  const marker = `<!--${name}:${encodeURIComponent(JSON.stringify(value))}-->`;
  return expression.test(notes) ? notes.replace(expression, marker) : [marker, notes].filter(Boolean).join("\n");
}
export function bookShelf(book: ReadingBook): "next" | "idea" | "library" {
  const meta = decodeMarker(book.notes, META);
  if (meta && typeof meta === "object" && "shelf" in meta) {
    const shelf = (meta as { shelf?: unknown }).shelf;
    if (shelf === "next" || shelf === "idea") return shelf;
  }
  return "library";
}
export function bookDomain(book: ReadingBook): string {
  const meta = decodeMarker(book.notes, META);
  return meta && typeof meta === "object" && "domain" in meta && typeof (meta as { domain?: unknown }).domain === "string"
    ? (meta as { domain: string }).domain : "";
}
export function bookMinutes(book: ReadingBook): number {
  const rows = decodeMarker(book.notes, TIME);
  if (!Array.isArray(rows)) return 0;
  return rows.reduce<number>((sum, row: unknown) => {
    if (!row || typeof row !== "object" || !("minutes" in row)) return sum;
    const minutes = (row as { minutes: unknown }).minutes;
    return sum + (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes : 0);
  }, 0);
}
export function bookProgress(book: ReadingBook): { page: number; pages: number } | null {
  const match = book.notes.match(PROGRESS);
  if (!match) return null;
  const page = Number(match[1]); const pages = Number(match[2]);
  return Number.isInteger(page) && Number.isInteger(pages) && pages > 0 && page >= 0
    ? { page: Math.min(page, pages), pages } : null;
}
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function required(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} cannot be empty.`);
  return value.trim();
}

/** Queries and writes are scoped to the signed-in account, using the Personal OS tables. */
export function useReadingLibrary(userId: string) {
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [quotes, setQuotes] = useState<SavedQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!userId) return;
    setError("");
    const db = client();
    const [bookResponse, quoteResponse] = await Promise.all([
      db.from("capital_reading_items").select("id,title,author,status,type,importance,notes,key_ideas,start_date,finish_date,created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(3000),
      db.from("capital_reading_quotes").select("id,text,reading_id,attribution,page,created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(3000),
    ]);
    if (bookResponse.error) throw bookResponse.error;
    if (quoteResponse.error) throw quoteResponse.error;
    setBooks(((bookResponse.data ?? []) as BookRow[]).map(bookFromRow));
    setQuotes(((quoteResponse.data ?? []) as QuoteRow[]).map(quoteFromRow));
  }, [userId]);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void reload().catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [reload]);

  const addBook = async (draft: BookDraft) => {
    const { data, error: writeError } = await client().from("capital_reading_items").insert({
      user_id: userId, title: required(draft.title, "Title"), author: draft.author.trim() || null,
      type: "Book", status: draft.status, importance: draft.importance,
      start_date: draft.status === "Reading" ? localToday() : null,
    }).select("*").single();
    if (writeError) throw writeError;
    const book = bookFromRow(data as BookRow);
    setBooks((current) => [book, ...current]);
    return book;
  };
  const updateBook = async (id: string, patch: Partial<BookDraft> & { notes?: string; finishDate?: string; startDate?: string }) => {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) update.title = required(patch.title, "Title");
    if (patch.author !== undefined) update.author = patch.author.trim() || null;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.importance !== undefined) update.importance = patch.importance;
    if (patch.notes !== undefined) update.notes = patch.notes;
    if (patch.finishDate !== undefined) update.finish_date = patch.finishDate || null;
    if (patch.startDate !== undefined) update.start_date = patch.startDate || null;
    const { data, error: writeError } = await client().from("capital_reading_items").update(update)
      .eq("user_id", userId).eq("id", id).select("*").single();
    if (writeError) throw writeError;
    const book = bookFromRow(data as BookRow);
    setBooks((current) => current.map((item) => item.id === id ? book : item));
    return book;
  };
  const logMinutes = async (book: ReadingBook, minutes: number) => {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) throw new Error("Enter 1–720 whole minutes.");
    const previous = decodeMarker(book.notes, TIME);
    const rows = Array.isArray(previous) ? previous : [];
    return updateBook(book.id, {
      notes: replaceMarker(book.notes, TIME, "reading-time", [...rows, { date: localToday(), minutes }].slice(-500)),
    });
  };
  const setProgress = async (book: ReadingBook, page: number, pages: number) => {
    if (!Number.isInteger(page) || !Number.isInteger(pages) || pages < 1 || page < 0 || page > pages)
      throw new Error("Enter a valid page and total, such as 45/240.");
    const marker = `<!--reading-progress:${page}/${pages}-->`;
    const notes = PROGRESS.test(book.notes) ? book.notes.replace(PROGRESS, marker)
      : [marker, book.notes].filter(Boolean).join("\\n");
    return updateBook(book.id, { notes });
  };
  const addQuote = async (draft: QuoteDraft) => {
    const { data, error: writeError } = await client().from("capital_reading_quotes").insert({
      user_id: userId, text: required(draft.text, "Quotation"), reading_id: draft.readingId,
      attribution: draft.attribution.trim() || null, page: draft.page.trim() || null,
    }).select("*").single();
    if (writeError) throw writeError;
    const quote = quoteFromRow(data as QuoteRow);
    setQuotes((current) => [quote, ...current]);
    return quote;
  };
  const updateQuote = async (id: string, draft: QuoteDraft) => {
    const { data, error: writeError } = await client().from("capital_reading_quotes").update({
      text: required(draft.text, "Quotation"), reading_id: draft.readingId,
      attribution: draft.attribution.trim() || null, page: draft.page.trim() || null, updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", id).select("*").single();
    if (writeError) throw writeError;
    const quote = quoteFromRow(data as QuoteRow);
    setQuotes((current) => current.map((item) => item.id === id ? quote : item));
    return quote;
  };
  const removeQuote = async (id: string) => {
    const { error: writeError } = await client().from("capital_reading_quotes")
      .delete().eq("user_id", userId).eq("id", id);
    if (writeError) throw writeError;
    setQuotes((current) => current.filter((item) => item.id !== id));
  };
  return { books, quotes, loading, error, reload, addBook, updateBook, logMinutes, setProgress, addQuote, updateQuote, removeQuote };
}
