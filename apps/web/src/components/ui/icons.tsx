/**
 * Minimal inline-SVG glyphs (no icon library — matches ThemeToggle/JobsTray convention:
 * 24×24 viewBox, `currentColor` stroke, `aria-hidden`). Sized to 1em so they ride the
 * button text. Used to tell apart same-colour secondary actions (ADR-0052): Export ↓ vs
 * Import ↑ are differentiated by the download/upload glyph, NOT a bare arrow (which reads
 * as a sort caret).
 */
type GlyphProps = { className?: string };

const COMMON = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** Export — arrow descending into a tray. */
export function DownloadIcon({ className }: GlyphProps) {
  return (
    <svg {...COMMON} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

/** Import — arrow rising out of a tray. */
export function UploadIcon({ className }: GlyphProps) {
  return (
    <svg {...COMMON} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/** Locked — a closed padlock. Marks an immutable field (e.g. a `createOnly` grid cell, UX-12). */
export function LockIcon({ className }: GlyphProps) {
  return (
    <svg {...COMMON} className={className}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
