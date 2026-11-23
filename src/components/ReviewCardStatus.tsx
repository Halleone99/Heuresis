import { ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight } from "lucide-react";
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

export default function ReviewCardStatus({ progress, historyAvailable, change }: Props) {
  const label = progress.mastered ? "Mastered" : progress.bars === 4 ? "Known" : progress.bars === 0 ? "Starting" : "Building";
  const reliable = historyAvailable && !progress.estimated;
  const delta = change ? change.barsAfter - change.barsBefore : 0;
  let changeText = "";
  let changeTitle = "";
  let trend: "up" | "down" | "level" = "level";
  if (change && reliable) {
    if (!change.masteredBefore && change.masteredAfter) {
      changeText = "Mastery confirmed";
      trend = "up";
    } else if (delta > 0) {
      changeText = `+${delta} ${delta === 1 ? "bar" : "bars"}`;
      trend = "up";
    } else if (delta < 0) {
      changeText = `−${Math.abs(delta)} ${delta === -1 ? "bar" : "bars"}`;
      trend = "down";
    } else if ((change.grade === "good" || change.grade === "easy") && progress.pendingDirections?.length) {
      changeText = "Pair pending";
      changeTitle = "This direction is retained. The opposite direction must also be recalled to gain a bar.";
    } else {
      changeText = "No bar change";
    }
  } else if (!reliable) {
    changeText = "Estimated";
    changeTitle = "Complete review history is unavailable; a precise change cannot be verified.";
  } else if (progress.pendingDirections?.length) {
    changeText = "Pair pending";
    changeTitle = "One direction was recalled. The opposite direction is needed to gain a bar.";
  }

  const statusTitle = `${label} · ${progress.bars}/4 bars.${progress.mastered ? " Mastery confirmed." : " Mastered is confirmed after a later successful review."}`;
  const accessible = `${statusTitle}${changeText ? ` ${changeText}.` : ""}`;
  return <span className="review-card-status" data-level={progress.mastered ? "mastered" : progress.bars === 4 ? "known" : "building"}
    data-trend={trend} data-changed={Boolean(change && reliable)} role="status" aria-live="polite"
    aria-label={accessible} title={changeTitle || statusTitle}>
    <span className="review-card-status-bars" aria-hidden="true">
      {[0, 1, 2, 3].map((bar) => <i key={bar} className={bar < progress.bars ? "filled" : ""}/>)}
    </span>
    <span className="review-card-status-name">{label}</span>
    <span className="review-card-status-count">{progress.bars}/4</span>
    {changeText ? <span className="review-card-status-change" aria-hidden="true">
      {trend === "up" ? <ArrowUpRight size={12}/> : trend === "down" ? <ArrowDownRight size={12}/> :
        changeText === "Pair pending" ? <ArrowLeftRight size={12}/> : <ArrowRight size={12}/>}
      <span>{changeText}</span>
    </span> : null}
  </span>;
}
