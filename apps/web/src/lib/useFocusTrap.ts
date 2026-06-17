import { useEffect, useRef } from 'react';

/**
 * Focus management for transient overlays — menus (role=menu popovers) and modal
 * dialogs (role=dialog). Closes the carried-OPEN keyboard-nav/a11y gap on the
 * DataGrid menus and the admin dialogs (DATAGRID_STANDARD §19/§20; axe gate 29).
 *
 * While `active`:
 *  - moves focus into the container on open (first focusable element);
 *  - traps Tab / Shift+Tab inside the container (cyclic);
 *  - calls `onEscape` on the Escape key (stops propagation so a nested overlay
 *    closes only the innermost layer);
 * and on close it restores focus to the element that opened the overlay — but only
 * when focus would otherwise be lost (still inside the overlay, or on <body>), so a
 * deliberate click on another control is never yanked back.
 *
 * Attach the returned ref to the overlay container. `onEscape` is read through a ref,
 * so changing the handler each render never re-runs the effect (no focus re-grab).
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape: () => void,
): React.RefObject<T | null> {
  // React 19's `useRef<T>(null)` yields `RefObject<T | null>`; the ref attribute
  // accepts that, so the return type is widened to match (was `RefObject<T>`).
  const containerRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Initial focus: first focusable, falling back to the container itself.
    const first = focusables()[0];
    if (first) first.focus();
    else {
      container.tabIndex = -1;
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = els[0]!;
      const lastEl = els[els.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey) {
        if (activeEl === firstEl || !container.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (activeEl === lastEl || !container.contains(activeEl)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      const activeEl = document.activeElement;
      if (!activeEl || activeEl === document.body || container.contains(activeEl)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [active]);

  return containerRef;
}
