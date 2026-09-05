export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label="Heuresis epsilon mark">
      <text
        x="16"
        y="23.5"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="25"
        fontWeight="400"
        letterSpacing="-0.8"
      >ε</text>
    </svg>
  );
}
