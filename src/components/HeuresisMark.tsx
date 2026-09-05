export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Heuresis epsilon mark">
      <defs>
        <linearGradient id="heuresis-epsilon" x1="15" y1="9" x2="47" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.56" stopColor="#eadfc9" />
          <stop offset="1" stopColor="#bfa889" />
        </linearGradient>
        <linearGradient id="heuresis-spark" x1="49" y1="17" x2="49" y2="45" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d9c3a1" stopOpacity="0" />
          <stop offset="0.5" stopColor="#d9c3a1" />
          <stop offset="1" stopColor="#d9c3a1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <text
        x="6"
        y="51"
        fill="url(#heuresis-epsilon)"
        fontFamily="'Libre Caslon Display', 'Times New Roman', Georgia, serif"
        fontSize="55"
        fontWeight="400"
        letterSpacing="-2"
      >ε</text>
      <path d="M49.2 15.5v32" stroke="url(#heuresis-spark)" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M49.2 24.1c.48 3.8 2.12 5.45 5.92 5.93-3.8.47-5.44 2.12-5.92 5.92-.47-3.8-2.12-5.45-5.92-5.92 3.8-.48 5.45-2.13 5.92-5.93Z"
        fill="#d8bea0"
      />
    </svg>
  );
}
