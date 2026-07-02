/**
 * CRM2 brand mark + wordmark — the single source for the app logo (login, sidebar, header).
 * The mark is a verification shield (trust / KYC) with an open "C". Tokenized, so it is correct
 * in both light and dark themes. `tone="inverse"` reverses it (white shield, brand-colored glyph)
 * for use on a solid brand-colored surface. The matching browser favicon is the static asset
 * apps/web/public/favicon.svg (favicons can't read CSS vars, so it carries the brand color inline).
 *
 * Brand policy (DESIGN_AND_STACK_FREEZE.md): CRM2 is an independent product — NOT ACS. No ACS
 * marks anywhere. This component is the only CRM2 wordmark; reuse it, don't hand-roll another.
 */
export function Logo({
  size = 22,
  wordmarkClass = 'text-base',
  tone = 'default',
  className = '',
}: {
  size?: number;
  /** Tailwind text-size class for the wordmark (login uses a larger size than the chrome). */
  wordmarkClass?: string;
  /** 'inverse' = white shield + brand-colored glyph + white wordmark, for solid brand surfaces. */
  tone?: 'default' | 'inverse';
  className?: string;
}) {
  const inverse = tone === 'inverse';
  const shield = inverse ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))';
  const glyph = inverse ? 'hsl(var(--primary))' : 'hsl(var(--primary-foreground))';
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="shrink-0">
        {/* Verification shield — brand primary */}
        <path d="M24 3 L41 9 V23 C41 33 33.5 40 24 44 C14.5 40 7 33 7 23 V9 Z" fill={shield} />
        {/* Open "C" inside — the wordmark carries the rest of the name */}
        <path
          d="M30 18 A8 8 0 1 0 30 30"
          fill="none"
          stroke={glyph}
          strokeWidth="3.6"
          strokeLinecap="round"
        />
      </svg>
      <span
        className={`${wordmarkClass} font-bold tracking-tight ${inverse ? 'text-primary-foreground' : 'text-foreground'}`}
      >
        CRM2
      </span>
    </span>
  );
}
