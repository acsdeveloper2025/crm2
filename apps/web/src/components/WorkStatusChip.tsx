/**
 * Shared work(task)-status badge — the single source for the status→token map that was duplicated
 * across PipelinePage/CaseDetailPage/DedupePage (COLOR_SYSTEM_FREEZE, frozen `st-*` tokens). The 8
 * frozen status tokens have no "completed", so COMPLETED maps to the approved tone; an unknown
 * status falls back to a neutral surface rather than rendering unstyled. `workStatusChipClass` is
 * pure (unit-tested without jsdom, mirroring `buttonClass`).
 */
const CHROME = 'rounded px-2 py-0.5 text-xs font-medium';

/** Task workflow status → frozen `st-*` bg/text token pair. */
const TONE: Record<string, string> = {
  PENDING: 'bg-st-pending-bg text-st-pending',
  ASSIGNED: 'bg-st-assigned-bg text-st-assigned',
  IN_PROGRESS: 'bg-st-in-progress-bg text-st-in-progress',
  SUBMITTED: 'bg-st-under-review-bg text-st-under-review',
  COMPLETED: 'bg-st-approved-bg text-st-approved',
  REVOKED: 'bg-st-rejected-bg text-st-rejected',
  CANCELLED: 'bg-st-rejected-bg text-st-rejected',
};

/** Full className for a work-status chip (chrome + the status's frozen token pair, neutral fallback). */
export function workStatusChipClass(status: string): string {
  return `${CHROME} ${TONE[status] ?? 'bg-surface-muted'}`;
}

/** Status pill for a task's workflow status. Underscores in the status render as spaces. */
export function WorkStatusChip({ status }: { status: string }) {
  return <span className={workStatusChipClass(status)}>{status.replace(/_/g, ' ')}</span>;
}
