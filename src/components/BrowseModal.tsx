import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";

type Props = { pack: PackWithType; cards: CardWithStats[]; onClose: () => void; onComplete: () => void };

export default function BrowseModal({ pack, cards, onClose, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const card = cards[index] ?? null;
  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const primary = useMemo(() => new Set([term?.key, reading?.key, meaning?.key].filter((key): key is string => Boolean(key))), [term?.key, reading?.key, meaning?.key]);

  function close() {
    onComplete();
    onClose();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "ArrowRight") setIndex((value) => Math.min(cards.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) return null;
  return <div className="immersive-layer browse-layer"><header className="immersive-bar"><span><b>{pack.title}</b> · Browse · {index + 1} / {cards.length}</span><button onClick={close}><X size={16} /> Close</button></header><main className="browse-stage"><article className="browse-card"><div className="browse-main"><p className="eyebrow">CARD {index + 1}</p><h1>{fieldText(card.data, term?.key) || "Untitled"}</h1>{reading ? <h2>{fieldText(card.data, reading.key)}</h2> : null}<div className="browse-meaning">{fieldText(card.data, meaning?.key)}</div></div>{pack.cardType?.field_schema.filter((field) => !primary.has(field.key) && fieldText(card.data, field.key)).length ? <div className="browse-details">{pack.cardType.field_schema.filter((field) => !primary.has(field.key) && fieldText(card.data, field.key)).map((field) => <div key={field.key}><span>{field.label}</span><p>{fieldText(card.data, field.key)}</p></div>)}</div> : null}{card.tags.length ? <div className="browse-tags">{card.tags.map((tag) => <span className={tag.is_badge ? "badge" : ""} key={tag.id}>{tag.name}</span>)}</div> : null}{card.note ? <aside>{card.note}</aside> : null}</article></main><footer className="immersive-controls"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}><ArrowLeft size={15} /> Previous</button><span>Browsing does not change review statistics</span><button className="primary-button" onClick={() => { if (index >= cards.length - 1) close(); else setIndex((value) => value + 1); }}>{index >= cards.length - 1 ? "Finish" : <>Next <ArrowRight size={15} /></>}</button></footer></div>;
}
