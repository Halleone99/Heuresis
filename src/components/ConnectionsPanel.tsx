import { ArrowLeft, Link2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, listCardsByIds, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { aggregatePerformance, formatSeen } from "../lib/learningSignals";
import { listRelatedCatalogue, type RelatedCatalogueRow, type RelationType } from "../lib/related";

type Props = { pack: PackWithType; card: CardWithStats; onClose: () => void };
type Relation = { id: string; source: string; target: string; type: RelationType };
type Point = { id: string; x: number; y: number; ring: 0 | 1 | 2; relation?: Relation; parent?: string };

const RELATION_META: Record<RelationType, { label: string; colour: string }> = {
  synonym: { label: "Synonym", colour: "var(--signal-sage, #63775c)" },
  antonym: { label: "Antonym", colour: "var(--signal-red, #a4402f)" },
  related: { label: "Related", colour: "var(--signal-warm, #8f6747)" },
};

function scorePercent(card: CardWithStats | undefined) {
  const value = card ? aggregatePerformance(card) : null;
  return value === null ? null : Math.round(value * 100);
}

export default function ConnectionsPanel({ pack, card, onClose }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [cards, setCards] = useState<Record<string, CardWithStats>>({ [card.id]: card });
  const [rootId, setRootId] = useState(card.id);
  const [trail, setTrail] = useState<string[]>([card.id]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<RelationType, boolean>>({ synonym: true, antonym: true, related: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    void listRelatedCatalogue(pack.id)
      .then(async (nextRows) => {
        const ids = Array.from(new Set(nextRows.flatMap((row) => [row.source_card_id, row.target_card_id])));
        const nextCards = await listCardsByIds(ids);
        if (!alive) return;
        setRows(nextRows);
        setCards(Object.fromEntries(nextCards.map((item) => [item.id, item])));
      })
      .catch((loadError) => { if (alive) setError(loadError instanceof Error ? loadError.message : "Could not load connections."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [pack.id]);

  const relations = useMemo<Relation[]>(() => rows.map((row) => ({ id: row.relation_id, source: row.source_card_id, target: row.target_card_id, type: row.relation_type })), [rows]);
  const relatedOnlyIds = useMemo(() => new Set(rows.filter((row) => row.target_role === "related").map((row) => row.target_card_id)), [rows]);
  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;

  function links(id: string) {
    return relations.filter((relation) => enabled[relation.type] && (relation.source === id || relation.target === id));
  }

  const layout = useMemo(() => {
    const direct = links(rootId).slice(0, 14);
    const points: Point[] = [{ id: rootId, x: 50, y: 50, ring: 0 }];
    direct.forEach((relation, index) => {
      const other = relation.source === rootId ? relation.target : relation.source;
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, direct.length);
      const radiusX = direct.length > 9 && index % 2 ? 36 : 31;
      const radiusY = direct.length > 9 && index % 2 ? 34 : 29;
      points.push({ id: other, x: 50 + Math.cos(angle) * radiusX, y: 50 + Math.sin(angle) * radiusY, ring: 1, relation });
    });
    if (hovered) {
      const parent = points.find((point) => point.id === hovered && point.ring === 1);
      if (parent) {
        const branch = links(hovered).filter((relation) => {
          const other = relation.source === hovered ? relation.target : relation.source;
          return other !== rootId && !points.some((point) => point.id === other);
        }).slice(0, 4);
        const base = Math.atan2(parent.y - 50, parent.x - 50);
        branch.forEach((relation, index) => {
          const other = relation.source === hovered ? relation.target : relation.source;
          const spread = branch.length === 1 ? 0 : (index - (branch.length - 1) / 2) * 0.34;
          points.push({ id: other, x: parent.x + Math.cos(base + spread) * 17, y: parent.y + Math.sin(base + spread) * 18, ring: 2, relation, parent: hovered });
        });
      }
    }
    return points;
  }, [enabled, hovered, relations, rootId]);

  const directIds = new Set(layout.filter((point) => point.ring === 1).map((point) => point.id));
  const chords = relations.filter((relation) => enabled[relation.type] && directIds.has(relation.source) && directIds.has(relation.target));
  const pointById = new Map(layout.map((point) => [point.id, point]));
  const rootCard = cards[rootId] ?? card;

  function recenter(id: string) {
    if (id === rootId) return;
    const existing = trail.indexOf(id);
    setTrail(existing >= 0 ? trail.slice(0, existing + 1) : [...trail, id]);
    setRootId(id);
    setHovered(null);
  }

  function nodeCopy(id: string) {
    const node = cards[id];
    if (!node) return { term: "…", reading: "", meaning: "" };
    return { term: fieldText(node.data, term?.key) || "Untitled", reading: fieldText(node.data, reading?.key), meaning: fieldText(node.data, meaning?.key) };
  }

  return <div className="connections-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="connections-panel" role="dialog" aria-modal="true" aria-label="Card connections">
      <header className="connections-head">
        <div><p className="eyebrow">CONNECTIONS</p><h2>{nodeCopy(rootId).term}</h2><p>{nodeCopy(rootId).reading}{nodeCopy(rootId).reading && nodeCopy(rootId).meaning ? " · " : ""}{nodeCopy(rootId).meaning}</p></div>
        <div className="connections-head-actions"><div className="connections-filters">{(["synonym", "antonym", "related"] as RelationType[]).map((type) => <button key={type} aria-pressed={enabled[type]} onClick={() => setEnabled((current) => ({ ...current, [type]: !current[type] }))}><i data-type={type} />{RELATION_META[type].label}</button>)}</div><button className="connections-close" onClick={onClose}><X size={17} /></button></div>
      </header>

      {trail.length > 1 ? <nav className="connections-trail">{trail.map((id, index) => <span key={`${id}-${index}`}>{index ? <b>›</b> : null}<button onClick={() => { setTrail(trail.slice(0, index + 1)); setRootId(id); setHovered(null); }}>{nodeCopy(id).term}</button></span>)}</nav> : null}

      <div className="connections-map" onMouseLeave={() => setHovered(null)}>
        {loading ? <div className="connections-state">Opening this neighbourhood…</div> : null}
        {error ? <div className="connections-state error">{error}</div> : null}
        {!loading && !error && !links(rootId).length ? <div className="connections-state"><Link2 size={20} /><strong>No connections yet.</strong><span>Add related words while sorting or reviewing this card.</span></div> : null}
        {!loading && !error && links(rootId).length ? <>
          <svg className="connections-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {layout.filter((point) => point.ring === 1).map((point) => <line key={`edge-${point.id}`} x1="50" y1="50" x2={point.x} y2={point.y} className={`connection-line type-${point.relation?.type ?? "related"}`} />)}
            {layout.filter((point) => point.ring === 2).map((point) => { const parent = point.parent ? pointById.get(point.parent) : null; return parent ? <line key={`branch-${point.id}`} x1={parent.x} y1={parent.y} x2={point.x} y2={point.y} className={`connection-line branch type-${point.relation?.type ?? "related"}`} /> : null; })}
            {chords.map((relation) => { const a = pointById.get(relation.source); const b = pointById.get(relation.target); if (!a || !b) return null; return <line key={`chord-${relation.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`connection-chord type-${relation.type}`} />; })}
          </svg>
          {layout.map((point) => {
            const node = cards[point.id];
            const copy = nodeCopy(point.id);
            const score = scorePercent(node);
            return <button key={`${point.id}-${point.ring}`} className={`connection-node ring-${point.ring} ${relatedOnlyIds.has(point.id) ? "related-only" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onMouseEnter={() => point.ring === 1 ? setHovered(point.id) : undefined} onFocus={() => point.ring === 1 ? setHovered(point.id) : undefined} onClick={() => recenter(point.id)}>
              <strong>{copy.term}</strong>{copy.reading ? <em>{copy.reading}</em> : null}{point.ring !== 2 && copy.meaning ? <span>{copy.meaning}</span> : null}<i className="connection-meter"><b style={{ width: `${score ?? 0}%` }} /></i>
            </button>;
          })}
        </> : null}
      </div>

      <footer className="connections-foot"><span><i className="sample-dash" /> dashed node = related identity, not yet promoted</span><span>bar = historical Good/Easy review performance</span><span>{rootCard.stats.encounter_count ? formatSeen(rootCard.stats.last_encountered_at) : "never reviewed"}</span></footer>
    </section>
  </div>;
}
