import { useEffect, useState } from "react";
import { deleteHighlightRule, listHighlightRules, type HighlightRule } from "../lib/highlights";

export default function FormattingRuleList({ language }: { language: string }) {
  const [rules, setRules] = useState<HighlightRule[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => {
      void listHighlightRules().then(next => { if (active) setRules(next); }).catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load formatting.");
      });
    };
    load();
    window.addEventListener("heuresis-highlights-updated", load);
    return () => { active = false; window.removeEventListener("heuresis-highlights-updated",load); };
  }, []);
  async function remove(id: string) {
    try {
      await deleteHighlightRule(id);
      setRules(current => current.filter(rule => rule.id !== id));
      window.dispatchEvent(new Event("heuresis-highlights-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove rule."); }
  }
  const selected = rules.filter(rule => rule.lang === language);
  return <section className="formatting-rules-list" aria-label="Formatting rules">
    <h3>Formatting</h3>
    {selected.length ? <ul>{selected.map(rule => <li key={rule.id}>
      <span>{rule.text} · {rule.style} · {rule.card_id ? "Card" : "All"}</span>
      <button type="button" title={"Remove formatting for " + rule.text} onClick={() => void remove(rule.id)}>×</button>
    </li>)}</ul> : <p>Select text on the revealed card to format it.</p>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
