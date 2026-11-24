import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { METHOD_LABEL, type ReviewMethod } from "../../lib/reviewPrefs";

const OPTIONS: ReviewMethod[] = ["think", "say", "type", "handwrite", "hear"];
type Props = {
  value: ReviewMethod;
  onChange: (method: ReviewMethod) => void;
  canListen: boolean;
};

export default function ReviewMethod21({ value, onChange, canListen }: Props) {
  const [open, setOpen] = useState(false);
  return <div className="study21-answer-method" onKeyDown={event => {if (event.key === "Escape" && open) {event.preventDefault();event.stopPropagation();setOpen(false);}}}>
    <span>ANSWER</span>
    <div className="study21-answer-anchor">
      <button type="button" className="study21-answer-pill" aria-expanded={open}
        onClick={() => setOpen(v => !v)}><span aria-hidden="true">●</span> {METHOD_LABEL[value]} <ChevronDown size={13}/></button>
      {open ? <div className="study21-answer-menu" role="group" aria-label="Answer method">
        {OPTIONS.map(method => <button type="button" key={method} aria-pressed={method === value}
          disabled={method === "hear" && !canListen} onClick={() => { onChange(method); setOpen(false); }}>
          {METHOD_LABEL[method]}
        </button>)}
      </div> : null}
    </div>
  </div>;
}
