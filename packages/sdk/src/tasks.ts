import { z } from 'zod';
import { VISIT_TYPES, DISTANCE_BANDS } from './cases.js';
import type { CaseTaskStatus, DistanceBand, VisitType } from './cases.js';
import type { KINDS } from './verificationUnit.js';

/**
 * @crm2/sdk — Pipeline contract (operations task queue). A TaskView is one `case_task` row with
 * its case context denormalised for the list (all 1:1 joins). Additive to the cases contract —
 * mobile (ADR-0012) is unaffected.
 */
export interface TaskView {
  id: string;
  caseId: string;
  caseNumber: string;
  /** Per-task number `case_number-<seq>` (ADR-0023) — the row's identity in the Pipeline. */
  taskNumber: string;
  clientId: number;
  clientName: string;
  productName: string;
  /** primary applicant of the case (null only for legacy/seed data without one). */
  primaryName: string | null;
  verificationUnitId: number;
  unitCode: string;
  unitName: string;
  unitKind: (typeof KINDS)[number];
  status: CaseTaskStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  visitType: VisitType | null;
  distanceBand: DistanceBand | null;
  billCount: number;
  assignedAt: string | null;
  /** OCC token — bulk-assign sends it per row; a changed row comes back CONFLICT. */
  version: number;
  /** Billing VIEW (ADR-0036 slice 5d). `billable` = the task is COMPLETED (only completed tasks
   *  bill — eligibility is ANY completed task). `billAmount`/`commissionAmount` are DERIVED at read
   *  time from rate management (rates ladder) + commission_rates (assignee's rate for the resolved
   *  rate type); null when no active rate/commission is configured. No billed-state is persisted. */
  billable: boolean;
  billAmount: number | null;
  commissionAmount: number | null;
  /** SLA breach (ADR-0032): an OPEN task (PENDING/ASSIGNED/IN_PROGRESS) whose age since creation
   *  exceeds its priority's TAT (URGENT 12h · HIGH 24h · MEDIUM 48h · LOW 72h). Derived, not stored. */
  outOfTat: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Scoped bucket counts for the Pipeline bucket bar (honors search + non-status filters). `revoked`
 *  replaces the old `cancelled` bucket; `outOfTat` is the SLA-breach bucket (derived, cross-status). */
export interface TaskStats {
  pending: number;
  assigned: number;
  inProgress: number;
  completed: number;
  revoked: number;
  outOfTat: number;
  /** Commissionable bucket (ADR-0036 slice 5d): COMPLETED tasks whose assignee has a resolved
   *  commission for the task's rate type. Mutually exclusive with the status/SLA buckets. */
  commissionable: number;
  total: number;
}

const uuid = z.string().uuid();
const MAX_BULK_ASSIGN_ITEMS = 500;
const MAX_BILL_COUNT = 50;

/**
 * Bulk assignment (Pipeline workbench): N selected tasks → ONE executive with shared visit/
 * distance/bill attributes. Per-row OCC (`version`) + per-row outcome — a failed row never
 * aborts the batch (B-23 precedent).
 */
export const BulkAssignSchema = z.object({
  items: z
    .array(z.object({ id: uuid, version: z.number().int().min(0) }))
    .min(1)
    .max(MAX_BULK_ASSIGN_ITEMS),
  assignedTo: uuid,
  visitType: z.enum(VISIT_TYPES),
  // legacy/optional — rate type now comes from rate management (ADR-0024); UI no longer collects it.
  distanceBand: z.enum(DISTANCE_BANDS).optional(),
  billCount: z.number().int().min(0).max(MAX_BILL_COUNT),
});
export type BulkAssignInput = z.infer<typeof BulkAssignSchema>;

export type BulkAssignRowStatus = 'OK' | 'CONFLICT' | 'NOT_FOUND' | 'NOT_ASSIGNABLE' | 'INELIGIBLE_ASSIGNEE';

/** Per-row outcome of a bulk assignment (the UI summarizes counts, keeps failures selected). */
export interface BulkAssignResult {
  results: { id: string; status: BulkAssignRowStatus }[];
  okCount: number;
  conflictCount: number;
  notFoundCount: number;
  notAssignableCount: number;
  ineligibleCount: number;
}
