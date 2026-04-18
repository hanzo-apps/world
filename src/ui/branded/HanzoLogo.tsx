/**
 * Hanzo "H" monogram + "World" wordmark. Reused across nav and footer.
 *
 * The mark is a minimal H glyph in 24x24 — kept as inline SVG so the dark
 * theme inverts via `currentColor` without a second asset.
 */
export function HanzoLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`hanzo-chrome inline-flex items-center gap-2 font-inter ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        className="text-foreground"
      >
        <rect x="1" y="1" width="22" height="22" rx="4" fill="currentColor" />
        <path d="M7 6h2.2v5h5.6V6H17v12h-2.2v-5H9.2v5H7z" fill="var(--background)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">Hanzo</span>
      <span className="text-[15px] font-light tracking-tight text-muted-foreground">World</span>
    </span>
  );
}
