import { CASE_UPDATED_EVENT, type CaseTaskView, type CaseUpdateEvent } from '@crm2/sdk';
import { getRealtime } from '../../platform/realtime/index.js';

/**
 * Office realtime fan-out (ADR-0027). After a committed task/case status change, broadcast a lightweight
 * {@link CaseUpdateEvent} to the office room so web case/pipeline/dashboard views refetch live instead of
 * on a manual reload. Best-effort + fire-and-forget — `getRealtime()` is a no-op when no socket server is
 * running (tests / worker role), and the field app never joins the office room so the device isn't spammed.
 * MUST be called AFTER the repo write returns (post-commit) so a refetch never races an uncommitted row.
 */
export function emitTaskUpdate(task: CaseTaskView): void {
  const event: CaseUpdateEvent = {
    caseId: task.caseId,
    caseNumber: task.caseNumber,
    taskId: task.id,
    taskNumber: task.taskNumber,
    status: task.status,
  };
  getRealtime().emitToOffice(CASE_UPDATED_EVENT, event);
}

/** Case-level variant (no single task) — e.g. case finalize closing the case. */
export function emitCaseStatusUpdate(caseId: string, caseNumber: string): void {
  const event: CaseUpdateEvent = { caseId, caseNumber };
  getRealtime().emitToOffice(CASE_UPDATED_EVENT, event);
}
