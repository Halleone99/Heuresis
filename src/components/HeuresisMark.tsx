export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Heuresis mark">
      <path d="M9 7.5v17M23 7.5v17M9 16h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
