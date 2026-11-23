import { useState } from "react";
import { BookOpen, CheckCircle2, ChevronUp } from "lucide-react";
import { IMPORTANCE_LABEL, IMPORTANCE_ORDER, type Importance } from "../../lib/importance";

type Props = {
  importance: Importance;
  disabled: boolean;
  onImportance: (value: Importance) => void;
  onLearn: () => void;
  onReview: () => void;
};

const HINT: Record<Importance, string> = {
  core: "Recall it",
  useful: "Use it",
  peripheral: "Recognise it",
};

export default function NewDock21({ importance, disabled, onImportance, onLearn, onReview }: Props) {
  const [open, setOpen] = useState(false);
  return <div className="study21-new-dock">
    <div className="study21-type-row">
      <span>TYPE</span>
      <div className="study21-type-anchor">
        <button type="button" aria-label="Card type" aria-expanded={open} className="study21-type-pill"
          disabled={disabled} onClick={() => setOpen(value => !value)}>
          <span aria-hidden="true">●</span> {IMPORTANCE_LABEL[importance]} <ChevronUp size={13} />
        </button>
        {open ? <div className="study21-type-menu" role="group" aria-label="Choose type">
          {IMPORTANCE_ORDER.map(level => <button key={level} type="button" aria-pressed={importance === level}
            onClick={() => { onImportance(level); setOpen(false); }}>
            <span>{IMPORTANCE_LABEL[level]}</span><small>{HINT[level]}</small>
          </button>)}
        </div> : null}
      </div>
    </div>
    <div className="study21-destination" role="group" aria-label="Choose learning stage">
      <button type="button" className="study21-learn" disabled={disabled} onClick={onLearn}>
        <BookOpen size={17} /> Learn
      </button>
      <button type="button" className="study21-review" disabled={disabled} onClick={onReview}>
        <CheckCircle2 size={17} /> Review
      </button>
    </div>
  </div>;
}
