import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '../../lib/useFocusTrap.js';

/**
 * Shared dropdown popover for the app-shell triggers (account menu, notification bell,
 * jobs tray). Composes the platform `useFocusTrap` (focus-in on open, Tab cycling, Escape,
 * focus restore to the trigger) and adds outside-click dismissal — closing the focus-trap
 * gap the three hand-rolled header popovers carried (a11y P1) and deduping their identical
 * open/Escape/outside-click effect.
 *
 * The panel is a labelled `group` rather than `role="menu"` on purpose: these panels carry a
 * header + a scrollable list (not a flat list of menuitems), so a menu role would fail axe;
 * `useFocusTrap` makes them keyboard-operable regardless. The trigger advertises the popup via
 * `aria-haspopup` + `aria-expanded`.
 */
const PANEL_CHROME =
  'absolute right-0 z-50 mt-2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg';
const DEFAULT_TRIGGER =
  'relative rounded-md p-1 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground';

export interface PopoverProps {
  /** Accessible name for the trigger button. */
  label: string;
  /** Trigger inner content (icon + badge, avatar…). */
  trigger: ReactNode;
  /** Panel content; a function form receives `close` (e.g. to dismiss after navigating). */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Extra panel classes — width etc., e.g. `w-80 max-w-[calc(100vw-2rem)]`. */
  panelClassName?: string;
  /** Override the trigger button classes (defaults to the header icon-button style). */
  triggerClassName?: string;
  /** Accessible name for the panel container. */
  panelLabel?: string;
}

export function Popover({
  label,
  trigger,
  children,
  panelClassName,
  triggerClassName,
  panelLabel,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(open, () => setOpen(false));
  const close = useCallback(() => setOpen(false), []);

  // Outside-click dismissal (useFocusTrap owns focus + Escape, not pointer-outside).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        className={triggerClassName ?? DEFAULT_TRIGGER}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={panelRef}
          className={panelClassName ? `${PANEL_CHROME} ${panelClassName}` : PANEL_CHROME}
          {...(panelLabel ? { role: 'group', 'aria-label': panelLabel } : {})}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
