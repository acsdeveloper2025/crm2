import type { CaseReportFormat } from '@crm2/sdk';
import type { Actor } from '../../platform/scope/index.js';

/**
 * CASE_REPORT job payload — shared by the enqueue site (service.ts) and the processor (job.ts).
 * Lives here (not in job.ts) so service.ts can reference the type without importing the processor,
 * which would form a service↔job cycle (no-circular boundary rule).
 */
export interface CaseReportJobPayload {
  caseId: string;
  format: CaseReportFormat;
  actor: Actor;
}
