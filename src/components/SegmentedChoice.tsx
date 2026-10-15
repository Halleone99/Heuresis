import type { ReactNode } from "react";

export type ChoiceOption<T extends string> = { value: T; label: string; icon?: ReactNode; disabled?: boolean };

/** One keyboard- and touch-accessible control for mutually exclusive app choices. */
export function SegmentedChoice<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return <div className={className} role="group" aria-label={label}>
    {options.map((item) => <button key={item.value} type="button" className={value === item.value ? "selected" : ""}
      aria-pressed={value === item.value} disabled={item.disabled} onClick={() => onChange(item.value)}>
      {item.icon}{item.label}
    </button>)}
  </div>;
}
