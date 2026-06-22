/**
 * Shared workflow-status badge — the single source for the status→token map that was duplicated
 * across PipelinePage/CaseDetailPage/DedupePage/CasesPage (COLOR_SYSTEM_FREEZE, frozen `st-*`
 * tokens). The map is a SUPERSET of the task domain (PENDING/ASSIGNED/IN_PROGRESS/SUBMITTED/
 * COMPLETED/REVOKED/CANCELLED) and the case domain (NEW/IN_PROGRESS/AWAITING_COMPLETION/COMPLETED/
 * REVOKED/CANCELLED) — the shared keys map to the SAME token in both, so one chip serves both. The
 * frozen set has no "completed", so COMPLETED maps to the approved tone; an unknown status falls
 * back to a neutral surface rather than rendering unstyled. `workStatusChipClass` is pure
 * (unit-tested without jsdom, mirroring `buttonClass`).
 */
const CHROME = 'rounded px-2 py-0.5 text-xs font-medium';

/** Workflow status (task OR case) → frozen `st-*` bg/text token pair. */
const TONE: Record<string, string> = {
  NEW: 'bg-st-pending-bg text-st-pending',
  PENDING: 'bg-st-pending-bg text-st-pending',
  ASSIGNED: 'bg-st-assigned-bg text-st-assigned',
  IN_PROGRESS: 'bg-st-in-progress-bg text-st-in-progress',
  SUBMITTED: 'bg-st-under-review-bg text-st-under-review',
  AWAITING_COMPLETION: 'bg-st-under-review-bg text-st-under-review',
  COMPLETED: 'bg-st-approved-bg text-st-approved',
  REVOKED: 'bg-st-rejected-bg text-st-rejected',
  CANCELLED: 'bg-st-rejected-bg text-st-rejected',
};

/** Full className for a work-status chip (chrome + the status's frozen token pair, neutral fallback). */
export function workStatusChipClass(status: string): string {
  return `${CHROME} ${TONE[status] ?? 'bg-surface-muted'}`;
}

/**
 * Status pill for a task or case workflow status. Underscores render as spaces unless an explicit
 * `label` is given (e.g. the case domain's CASE_STATUS_LABELS friendly names).
 */
export function WorkStatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={workStatusChipClass(status)}>{label ?? status.replace(/_/g, ' ')}</span>;
}
