import { Link2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, listCardsByIds, listCollections, listPacks, type CardWithStats, type Collection, type PackWithType } from "../lib/heuresis";
import { aggregatePerformance, formatSeen } from "../lib/learningSignals";
import { listRelatedCatalogue, relationLabel, RELATION_TYPES, type RelatedCatalogueRow, type RelationType } from "../lib/related";

type Props = { pack: PackWithType; card: CardWithStats; onClose: () => void };
type Relation = { id: string; source: string; target: string; type: RelationType };
type Point = { id: string; x: number; y: number; ring: 0 | 1 | 2; relation?: Relation; parent?: string };

function scorePercent(card: CardWithStats | undefined) {
  if (!card || card.stats.study_count <= 0) return null;
  const value = aggregatePerformance(card);
  return value === null ? null : Math.round(value * 100);
}

export default function ConnectionsPanel({ pack, card, onClose }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [cards, setCards] = useState<Record<string, CardWithStats>>({ [card.id]: card });
  const [packs, setPacks] = useState<PackWithType[]>([pack]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [rootId, setRootId] = useState(card.id);
  const [trail, setTrail] = useState<string[]>([card.id]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<RelationType, boolean>>(() => Object.fromEntries(RELATION_TYPES.map((type) => [type, true])) as Record<RelationType, boolean>);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    void Promise.all([listRelatedCatalogue(), listPacks(), listCollections()])
      .then(async ([nextRows, nextPacks, nextCollections]) => {
        const ids = Array.from(new Set(nextRows.flatMap((row) => [row.source_card_id, row.target_card_id])));
        if (!ids.includes(card.id)) ids.push(card.id);
        const nextCards = await listCardsByIds(ids);
        if (!alive) return;
        setRows(nextRows);
        setPacks(nextPacks);
        setCollections(nextCollections);
        setCards(Object.fromEntries(nextCards.map((item) => [item.id, item])));
      })
      .catch((loadError) => { if (alive) setError(loadError instanceof Error ? loadError.message : "Could not load connections."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [card.id]);

  const packMap = useMemo(() => new Map(packs.map((item) => [item.id, item])), [packs]);
  const collectionMap = useMemo(() => new Map(collections.map((item) => [item.id, item])), [collections]);
  const relations = useMemo<Relation[]>(() => rows.map((row) => ({ id: row.relation_id, source: row.source_card_id, target: row.target_card_id, type: row.relation_type })), [rows]);
  const relatedOnlyIds = useMemo(() => new Set(rows.filter((row) => row.target_role === "related").map((row) => row.target_card_id)), [rows]);
  const visibleTypes = useMemo(() => RELATION_TYPES.filter((type) => type === "related" || relations.some((relation) => relation.type === type)), [relations]);

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
    if (!node) return { term: "…", reading: "", meaning: "", origin: "" };
    const nodePack = packMap.get(node.pack_id) ?? (node.pack_id === pack.id ? pack : null);
    const term = fieldByRole(nodePack?.cardType, "term") ?? nodePack?.cardType?.field_schema[0] ?? null;
    const reading = fieldByRole(nodePack?.cardType, "reading");
    const meaning = fieldByRole(nodePack?.cardType, "meaning") ?? nodePack?.cardType?.field_schema[1] ?? null;
    const collection = nodePack ? collectionMap.get(nodePack.collection_id) : null;
    return {
      term: fieldText(node.data, term?.key) || "Untitled",
      reading: fieldText(node.data, reading?.key),
      meaning: fieldText(node.data, meaning?.key),
      origin: nodePack ? `${collection?.title ? `${collection.title} · ` : ""}${nodePack.title}` : "",
    };
  }

  const rootCopy = nodeCopy(rootId);

  return <div className="connections-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="connections-panel" role="dialog" aria-modal="true" aria-label="Knowledge connections">
      <header className="connections-head">
        <div><p className="eyebrow">CONNECTIONS · ALL HEURESIS</p><h2>{rootCopy.term}</h2><p>{rootCopy.reading}{rootCopy.reading && rootCopy.meaning ? " · " : ""}{rootCopy.meaning}</p>{rootCopy.origin ? <small style={{ display: "block", marginTop: 5, color: "#a0988f", fontSize: 9 }}>{rootCopy.origin}</small> : null}</div>
        <div className="connections-head-actions"><div className="connections-filters">{visibleTypes.map((type) => <button key={type} aria-pressed={enabled[type]} onClick={() => setEnabled((current) => ({ ...current, [type]: !current[type] }))}><i data-type={type} />{relationLabel(type)}</button>)}</div><button className="connections-close" onClick={onClose}><X size={17} /></button></div>
      </header>

      {trail.length > 1 ? <nav className="connections-trail">{trail.map((id, index) => <span key={`${id}-${index}`}>{index ? <b>›</b> : null}<button onClick={() => { setTrail(trail.slice(0, index + 1)); setRootId(id); setHovered(null); }}>{nodeCopy(id).term}</button></span>)}</nav> : null}

      <div className="connections-map" onMouseLeave={() => setHovered(null)}>
        {loading ? <div className="connections-state">Opening this neighbourhood…</div> : null}
        {error ? <div className="connections-state error">{error}</div> : null}
        {!loading && !error && !links(rootId).length ? <div className="connections-state"><Link2 size={20} /><strong>No connections yet.</strong><span>Connect this entry to any idea, term or concept in Heuresis.</span></div> : null}
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
            return <button key={`${point.id}-${point.ring}`} className={`connection-node ring-${point.ring} ${relatedOnlyIds.has(point.id) ? "related-only" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onMouseEnter={() => point.ring === 1 ? setHovered(point.id) : undefined} onFocus={() => point.ring === 1 ? setHovered(point.id) : undefined} onClick={() => recenter(point.id)} title={copy.origin}>
              <strong>{copy.term}</strong>{copy.reading ? <em>{copy.reading}</em> : null}{point.ring !== 2 && copy.meaning ? <span>{copy.meaning}</span> : null}{point.ring !== 2 && copy.origin ? <small style={{ marginTop: 4, maxWidth: 126, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#aaa197", fontSize: 7.5 }}>{copy.origin}</small> : null}{score !== null ? <i className="connection-meter"><b style={{ width: `${score}%` }} /></i> : null}
            </button>;
          })}
        </> : null}
      </div>

      <footer className="connections-foot"><span><i className="sample-dash" /> dashed node = Raw connected entry</span><span>review bar appears only when an entry has actually been studied</span><span>{rootCard.stats.study_count ? formatSeen(rootCard.stats.last_encountered_at) : "catalogued · not reviewed"}</span></footer>
    </section>
  </div>;
}
