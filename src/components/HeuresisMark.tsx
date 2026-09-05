export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Heuresis epsilon mark">
      <defs>
        <linearGradient id="heuresis-epsilon" x1="18" y1="10" x2="47" y2="53" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff7e6" />
          <stop offset="0.55" stopColor="#ead9b8" />
          <stop offset="1" stopColor="#c9a56f" />
        </linearGradient>
      </defs>
      <text
        x="8"
        y="48"
        fill="url(#heuresis-epsilon)"
        fontFamily="'Libre Caslon Display', 'Times New Roman', Georgia, serif"
        fontSize="53"
        fontWeight="400"
        letterSpacing="-2"
      >
        ε
      </text>
      <path
        d="M49.5 18.2c.55 4.55 2.52 6.53 7.08 7.08-4.56.55-6.53 2.53-7.08 7.08-.56-4.55-2.53-6.53-7.09-7.08 4.56-.55 6.53-2.53 7.09-7.08Z"
        fill="#d4b27d"
      />
    </svg>
  );
}
