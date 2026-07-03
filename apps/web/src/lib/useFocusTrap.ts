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
 *
 * `opts.arrowKeys` adds WAI-ARIA APG menu roving (KN-10): ArrowDown/Up move focus to the
 * next/previous focusable and Home/End jump to first/last (Tab-cycling is kept). Skipped while a
 * text-entry field is focused so cursor keys still move the caret — safe on menus that carry an
 * input (e.g. the Saved-Views name field).
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Arrow/Home/End must not be hijacked while a caret-bearing field is focused (they move the caret). */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit';
  }
  return false;
}

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape: () => void,
  opts?: { arrowKeys?: boolean },
): React.RefObject<T | null> {
  // React 19's `useRef<T>(null)` yields `RefObject<T | null>`; the ref attribute
  // accepts that, so the return type is widened to match (was `RefObject<T>`).
  const containerRef = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  // `opts` is a fresh object each render, so read `arrowKeys` through a ref — never an effect dep.
  const arrowKeysRef = useRef(opts?.arrowKeys ?? false);
  arrowKeysRef.current = opts?.arrowKeys ?? false;

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
      // APG menu roving (opt-in): Arrow/Home/End move focus among the trapped focusables.
      if (
        arrowKeysRef.current &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') &&
        !isTextEntry(document.activeElement)
      ) {
        const els = focusables();
        if (els.length === 0) return;
        e.preventDefault();
        const idx = els.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? els.length - 1
              : e.key === 'ArrowDown'
                ? idx < 0
                  ? 0
                  : (idx + 1) % els.length
                : idx <= 0
                  ? els.length - 1
                  : idx - 1;
        els[next]?.focus();
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
