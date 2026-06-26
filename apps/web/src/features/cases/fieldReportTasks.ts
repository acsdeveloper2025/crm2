import type { CaseTaskView } from '@crm2/sdk';

/** A2026-0623-17: the case-detail "Field Report" card is a FIELD-verification surface — desk/office
 *  tasks have no field submission and must not render under the 'Field Report' header with a
 *  misleading 'No field submission yet' state (KYC report-gen is deferred, ADR-0039). Filter by the
 *  task's visitType (FIELD vs OFFICE), the task-facing field/office signal (ADR-0070). */
export function fieldVisitTasks(tasks: CaseTaskView[]): CaseTaskView[] {
  return tasks.filter((t) => t.visitType === 'FIELD');
}
