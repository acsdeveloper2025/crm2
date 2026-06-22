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
 */
export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const SIZES: Record<ButtonSize, string> = {
  md: 'px-3 py-1.5 text-sm',
  sm: 'px-2 py-1 text-xs',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-primary-muted text-primary-hover hover:opacity-90',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary hover:underline',
};

/** Compose the className for a button variant + size (pure — unit-tested in Button.test.ts). */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = 'md'): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The one button component every page uses. Defaults to `primary`/`md`. */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = className ? `${buttonClass(variant, size)} ${className}` : buttonClass(variant, size);
  return <button type={type} className={cls} {...rest} />;
}
