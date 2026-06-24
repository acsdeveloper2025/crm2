import type { CaseTaskView } from '@crm2/sdk';

/** A2026-0623-17: the case-detail "Field Report" card is a FIELD-verification surface — desk tasks
 *  (KYC_DOCUMENT / DESK_DOCUMENT) have no field submission and must not render under the 'Field Report'
 *  header with a misleading 'No field submission yet' state (KYC report-gen is deferred, ADR-0039).
 *  Filter by the unit kind, which is assignment-independent (a not-yet-assigned field task still
 *  belongs here, unlike filtering on visitType which is null until assignment). */
export function fieldVisitTasks(tasks: CaseTaskView[]): CaseTaskView[] {
  return tasks.filter((t) => t.unitKind === 'FIELD_VISIT');
}
