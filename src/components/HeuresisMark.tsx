export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Heuresis mark">
      <path
        d="M46 18.5C41.2 12.3 29.1 10.5 21 15.4C13.6 19.9 13.8 28.2 21.3 31.3C27.8 34 38 31.8 45.3 27.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M45.5 39.1C38.9 34.3 29.3 31.9 22 34.6C14.4 37.4 13.4 45.2 20 50.1C27.3 55.6 40.3 53.8 46.5 45.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21.9 32.2C28.9 28.9 37 29.1 43.4 32.3C37.1 35.8 29.1 35.7 21.9 32.2Z" fill="currentColor" />
    </svg>
  );
}
