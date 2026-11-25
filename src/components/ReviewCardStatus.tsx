import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { CardBarProgress } from "../lib/cardProgress";
import { formatGap, daysUntilDue, stageOf, STAGE_INFO } from "../lib/knowledgeCurve";
import type { StudyGrade } from "../lib/study";

type ReviewChange = {
  grade: StudyGrade;
  barsBefore: number;
  barsAfter: number;
  masteredBefore: boolean;
  masteredAfter: boolean;
};

type Props = {
  progress: CardBarProgress;
  historyAvailable: boolean;
  change?: ReviewChange | null;
  study21?: boolean;
};

/** The bars carry the count; the caption stays quiet and only real movement gets a marker. */
export default function ReviewCardStatus({ progress, historyAvailable, change, study21 = false }: Props) {
  // Applied cards: where they are on the knowledge curve, not bars toward retirement.
  const label = progress.curve ? STAGE_INFO[stageOf(progress.curve.rung)].label
    : progress.mastered ? "Mastered" : progress.bars === 4 ? "Known" : progress.bars === 0 ? "Starting" : "Building";
  const reliable = historyAvailable && !progress.estimated;
  const delta = change && reliable ? change.barsAfter - change.barsBefore : 0;
  // "Recalled" is only a bar gain after the progress engine confirms a completed direction pair.
  const gainedFrom = change && reliable && delta > 0 ? change.barsBefore : -1;
  const justMastered = Boolean(change && reliable && !change.masteredBefore && change.masteredAfter);
  const trend: "up" | "down" | "level" = justMastered || delta > 0 ? "up" : delta < 0 ? "down" : "level";

  const statusTitle = progress.curve
    ? `${label} · on the knowledge curve, reviewed every ${formatGap(Math.max(1, progress.curve.intervalDays))}${daysUntilDue(progress.curve) ? `; next in ${formatGap(daysUntilDue(progress.curve))}` : ""}.`
    : `${label} · ${progress.bars} of 4 progress bars. ${progress.mastered ? "Mastery confirmed." : "Mastery requires a later successful review."}`;
  const context = !reliable
    ? "Progress is estimated because complete review history is unavailable."
    : progress.pendingDirections?.length
      ? "One direction was recalled; the opposite direction is needed to gain a bar."
      : "";
  const movement = justMastered ? "Mastery confirmed."
    : delta > 0 ? `Gained ${delta} ${delta === 1 ? "bar" : "bars"}.`
      : delta < 0 ? `Lost ${Math.abs(delta)} ${delta === -1 ? "bar" : "bars"}.` : "";
  const detail = [statusTitle, context, movement].filter(Boolean).join(" ");

  return <span className="review-card-status" data-level={progress.mastered ? "mastered" : progress.bars === 4 ? "known" : "building"}
    data-trend={trend} data-changed={trend !== "level"} role="status" aria-live="polite"
    aria-label={detail} title={detail}>
    <span className="review-card-status-bars" aria-hidden="true">
      {[0, 1, 2, 3].map((bar) => <i key={bar} className={`${bar < progress.bars ? "filled" : ""}${gainedFrom >= 0 && bar >= gainedFrom && bar < progress.bars ? " is-new" : ""}${study21 && change && reliable && delta < 0 && bar >= change.barsAfter && bar < change.barsBefore ? " is-lost" : ""}`}/>)}
    </span>
    <span className="review-card-status-name">{label}</span>
    {trend !== "level" ? <span className={`review-card-status-change${delta > 0 ? " is-gain" : ""}`} aria-hidden="true">
      {delta > 0 ? <span>+${delta}</span> : trend === "up" ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
      {delta < 0 ? <span>−${Math.abs(delta)}</span> : null}
    </span> : null}
  </span>;
}
