export default function HeuresisMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Heuresis Greek eta mark">
      <path
        fill="currentColor"
        d="M14 13h17v4h-5v13h12V17h-5v-4h17v4h-5v30h5v4H33v-4h5V35H26v12h5v4H14v-4h5V17h-5v-4Z"
      />
    </svg>
  );
}
