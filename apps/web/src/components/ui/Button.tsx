import type { ButtonHTMLAttributes } from 'react';

/**
 * Shared button system — ADR-0052 (button & action-emphasis).
 * Four looks + a text link, all from FROZEN tokens (no new colors):
 *   primary     = solid blue (the ONE main action per view: Create / + New / Add Task / Save)
 *   secondary   = tonal blue (Edit / Export / Import / Activate); soft `--primary-muted` fill +
 *                 `--primary-hover` text, which clears WCAG-AA on the muted fill in BOTH light
 *                 (blue-700 on blue-100) and dark (blue-400 on deep navy) — unlike `--primary`,
 *                 which is only ~3.9:1 in dark (Designer review 2026-06-22).
 *   destructive = filled red (Delete / Deactivate / Revoke)
 *   ghost       = borderless utility (Cancel / Columns / Views / pager / More)
 *   link        = text only (genuine inline links, never row actions)
 * Same-color actions (Export ↓ / Import ↑) are differentiated by icon, not colour.
 *
 * `loading` shows the platform hexagon marcher inline (never a spinning circle —
 * PAGINATION_AND_LOADING_STANDARDS §7) and disables the control. `iconOnly` makes a
 * square ≥44px touch target and REQUIRES an `aria-label` (enforced at the type level).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const SIZES: Record<ButtonSize, string> = {
  md: 'px-3 py-1.5 text-sm',
  sm: 'px-2 py-1 text-xs',
};

// Icon-only buttons are square, padding-free, and ≥44px (WCAG 2.5.5 / repo touch-target rule).
const ICON_SIZES: Record<ButtonSize, string> = {
  md: 'h-11 w-11 p-0',
  sm: 'h-9 w-9 p-0',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-primary-muted text-primary-hover hover:opacity-90',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary hover:underline',
};

/** Compose the className for a button variant + size (pure — unit-tested in Button.test.ts). */
export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize = 'md',
  opts?: { iconOnly?: boolean },
): string {
  const sizing = opts?.iconOnly ? ICON_SIZES[size] : SIZES[size];
  return `${BASE} ${sizing} ${VARIANTS[variant]}`;
}

const HEX_POINTS = '24,4 41.32,14 41.32,34 24,44 6.68,34 6.68,14';

/** Inline 1em hexagon marcher — inherits the button's text colour (`stroke-current`). */
function ButtonSpinner() {
  return (
    <svg viewBox="0 0 48 48" className="h-[1em] w-[1em] shrink-0" fill="none" aria-hidden="true">
      <polygon points={HEX_POINTS} className="stroke-current opacity-30" strokeWidth="4" />
      <polygon
        points={HEX_POINTS}
        pathLength={100}
        className="stroke-current hex-march"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="25 75"
      />
    </svg>
  );
}

type BaseButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows the platform hexagon marcher and disables the control. */
  loading?: boolean;
};

/** Icon-only buttons MUST carry an accessible name. */
export type ButtonProps =
  | (BaseButtonProps & { iconOnly: true; 'aria-label': string })
  | (BaseButtonProps & { iconOnly?: false });

/** The one button component every page uses. Defaults to `primary`/`md`. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconOnly = false,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const base = buttonClass(variant, size, { iconOnly });
  const cls = className ? `${base} ${className}` : base;
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <ButtonSpinner />}
      {children}
    </button>
  );
}
