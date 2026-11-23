import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { CardBarProgress } from "../lib/cardProgress";
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
};

/** The bars carry the count; the caption stays quiet and only real movement gets a marker. */
export default function ReviewCardStatus({ progress, historyAvailable, change }: Props) {
  const label = progress.mastered ? "Mastered" : progress.bars === 4 ? "Known" : progress.bars === 0 ? "Starting" : "Building";
  const reliable = historyAvailable && !progress.estimated;
  const delta = change && reliable ? change.barsAfter - change.barsBefore : 0;
  const justMastered = Boolean(change && reliable && !change.masteredBefore && change.masteredAfter);
  const trend: "up" | "down" | "level" = justMastered || delta > 0 ? "up" : delta < 0 ? "down" : "level";

  const statusTitle = `${label} · ${progress.bars} of 4 progress bars. ${progress.mastered ? "Mastery confirmed." : "Mastery requires a later successful review."}`;
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
      {[0, 1, 2, 3].map((bar) => <i key={bar} className={bar < progress.bars ? "filled" : ""}/>)}
    </span>
    <span className="review-card-status-name">{label}</span>
    {trend !== "level" ? <span className="review-card-status-change" aria-hidden="true">
      {trend === "up" ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
      {!justMastered ? <span>{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span> : null}
    </span> : null}
  </span>;
}
