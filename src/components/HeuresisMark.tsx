export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Heuresis epsilon mark">
      <defs>
        <linearGradient id="heuresis-epsilon" x1="12" y1="8" x2="44" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.5" stopColor="#eee2cb" />
          <stop offset="1" stopColor="#bea789" />
        </linearGradient>
        <linearGradient id="heuresis-spark" x1="51" y1="17" x2="51" y2="47" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d7c3a7" stopOpacity="0" />
          <stop offset="0.5" stopColor="#d7c3a7" stopOpacity=".9" />
          <stop offset="1" stopColor="#d7c3a7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <text
        x="4.5"
        y="52"
        fill="url(#heuresis-epsilon)"
        fontFamily="'Libre Caslon Display', 'Times New Roman', Georgia, serif"
        fontSize="57"
        fontWeight="400"
        letterSpacing="-2.5"
      >ε</text>
      <path d="M51 16.5v31" stroke="url(#heuresis-spark)" strokeWidth="1" strokeLinecap="round" />
      <path
        d="M51 25.1c.38 3.22 1.76 4.6 4.98 4.98-3.22.39-4.6 1.77-4.98 4.99-.39-3.22-1.77-4.6-4.99-4.99 3.22-.38 4.6-1.76 4.99-4.98Z"
        fill="#dcc4a4"
      />
    </svg>
  );
}
