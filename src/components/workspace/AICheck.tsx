import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { checkCaptureText, type ProofreadingSuggestion } from "../../lib/aiCheck";

type Props = {
  text: string;
  language?: string;
  context?: "note" | "mistake";
  onApply: (next: string) => Promise<void> | void;
  compact?: boolean;
};

/** On-demand, non-destructive proofreading for both drafts and saved knowledge. */
export function AICheck({ text, language = "Unknown", context = "note", onApply, compact = false }: Props) {
  const [reviewed, setReviewed] = useState("");
  const [suggestions, setSuggestions] = useState<ProofreadingSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  // Any new typing invalidates the suggestions; never apply edits to a changed draft.
  useEffect(() => {
    if (text !== reviewed) { setSuggestions(null); setError(""); setOpen(false); }
  }, [text, reviewed]);

  async function check() {
    if (busy || applying || !text.trim()) return;
    setBusy(true); setError(""); setOpen(true); setSuggestions(null);
    const checkedText = text;
    setReviewed(checkedText);
    try {
      const result = await checkCaptureText(checkedText, language, context);
      if (checkedText === text) setSuggestions(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Checking failed. Your note was not changed.");
    } finally { setBusy(false); }
  }

  async function apply(suggestion: ProofreadingSuggestion) {
    if (text !== reviewed || applying) return;
    if (text.split(suggestion.original).length !== 2) { setError("The original has changed. Check again."); return; }
    setApplying(true); setError("");
    try {
      const next = text.replace(suggestion.original, suggestion.replacement);
      await onApply(next);
      setSuggestions(null); setOpen(false); setReviewed("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not apply the suggestion. Your original was preserved.");
    } finally { setApplying(false); }
  }

  return <div className={`qc-ai ${compact ? "is-compact" : ""}`}>
    <button type="button" className="qc-ai-trigger" aria-label="AI — check spelling and grammar" disabled={busy || applying || !text.trim()}
      aria-expanded={open} onClick={() => { if (open && (suggestions || error)) setOpen(false); else void check(); }}>
      <Sparkles size={13} /> {busy ? "Checking…" : "AI · Check"}
    </button>
    {open ? <div className="qc-ai-results" role="status">
      <div className="qc-ai-results-head"><strong>Suggestions only</strong>
        <button type="button" aria-label="Close AI suggestions" onClick={() => setOpen(false)}><X size={13}/></button>
      </div>
      {busy ? <p>Checking for clear errors…</p> : null}
      {error ? <p className="qc-ai-error">{error}</p> : null}
      {!busy && !error && suggestions?.length === 0 ? <p>No clear errors found. This is not a guarantee of correctness.</p> : null}
      {suggestions?.map((suggestion, i) => <div key={i} className="qc-ai-suggestion">
        <div className="qc-ai-diff"><del>{suggestion.original}</del><span aria-hidden="true">→</span><strong>{suggestion.replacement}</strong></div>
        <p>{suggestion.reason}</p>
        <button type="button" disabled={applying || text !== reviewed} onClick={() => void apply(suggestion)}>
          <Check size={12}/> Apply
        </button>
      </div>)}
      {suggestions?.length ? <small>All changes require your approval. Original text stays unchanged until you apply one.</small> : null}
    </div> : null}
  </div>;
}
