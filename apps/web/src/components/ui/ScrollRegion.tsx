import type { ReactNode } from 'react';

/**
 * A horizontally-scrollable wrapper that is keyboard-focusable (axe `scrollable-region-focusable`):
 * a bespoke `overflow-x-auto` container is reachable by keyboard only with `tabIndex=0` + a labelled
 * `group` role. Encapsulates the pattern the DataGrid already applies to its table (DataGrid.tsx),
 * so the bespoke tables (CaseDetail/CPV/Import/Profile…) can adopt it in one line. The label is
 * suffixed with "(scroll horizontally)" to match the grid's accessible name.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** What the region contains, e.g. "Tasks" → "Tasks (scroll horizontally)". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `overflow-x-auto ${className}` : 'overflow-x-auto'}
      tabIndex={0}
      role="group"
      aria-label={`${label} (scroll horizontally)`}
    >
      {children}
    </div>
  );
}
