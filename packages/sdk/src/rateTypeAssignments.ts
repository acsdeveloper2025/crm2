import { z } from 'zod';

/**
 * @crm2/sdk — the Rate-Type Assignment contract (ADR-0067 / ADR-0069). One row =
 * (client [required], product [nullable = Universal], verification_unit [nullable = Universal],
 * rate_type [required]). It declares which rate type a (client × product × unit) combo may use; the
 * `/api/v2/rate-types/available` resolver unions a combo's own rows with its Universal (NULL) parents.
 * A standard CRUD master-data resource (DataGrid list + record-page form), like commission_rates but
 * simpler — no amount/location/tat/currency/effective-dating/version. Mirrors migration 0093 + 0096.
 */
export interface RateTypeAssignment {
  id: number;
  clientId: number;
  /** null ⇒ Universal (applies to every product) — mig 0096. */
  productId: number | null;
  /** null ⇒ Universal (applies to every unit) — mig 0096. */
  verificationUnitId: number | null;
  rateTypeId: number;
  /** joined from `rate_types` for display */
  rateTypeCode: string;
  /** joined from `rate_types` for display */
  rateTypeName: string;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An assignment joined with its client / product / unit display names (the list + record-page view). */
export interface RateTypeAssignmentView extends RateTypeAssignment {
  clientCode: string | null;
  clientName: string | null;
  /** null when Universal (productId null). */
  productCode: string | null;
  productName: string | null;
  /** null when Universal (verificationUnitId null). */
  verificationUnitName: string | null;
}

const MAX_PG_INT = 2147483647; // int4 — ids above this are a pg 22003, not a clean 400
const posInt = z.number().int().positive().max(MAX_PG_INT);

/**
 * Create one rate-type assignment. `clientId` + `rateTypeId` are required; `productId` /
 * `verificationUnitId` are nullable (null = Universal, stored as NULL with the NULLS-NOT-DISTINCT
 * unique key so re-creating the same combo re-activates rather than duplicating).
 */
export const CreateRateTypeAssignmentSchema = z.object({
  clientId: posInt,
  productId: posInt.nullable(),
  verificationUnitId: posInt.nullable(),
  rateTypeId: posInt,
});

export type CreateRateTypeAssignmentInput = z.infer<typeof CreateRateTypeAssignmentSchema>;

/** A single save fans the shared slot across at most this many rate types (the catalog is far smaller,
 *  so this is a sanity cap, not a real limit). Shared FE + BE (mirrors MAX_BULK_RATE_LOCATIONS). */
export const MAX_BULK_RATE_TYPE_ASSIGNMENTS = 200;

/**
 * Bulk-create assignments (ADR-0067 / ADR-0093 "set the slot once, fan across many rate types"): one
 * fixed `(client, product?, unit?)` slot + N rate types → one assignment row per rate type. Product /
 * unit are Universal-able (null). The rate-type set is the fan-out axis.
 */
export const BulkCreateRateTypeAssignmentsSchema = z.object({
  clientId: posInt,
  productId: posInt.nullable(),
  verificationUnitId: posInt.nullable(),
  rateTypeIds: z.array(posInt).min(1).max(MAX_BULK_RATE_TYPE_ASSIGNMENTS),
});

export type BulkCreateRateTypeAssignmentsInput = z.infer<typeof BulkCreateRateTypeAssignmentsSchema>;

/** Per-row outcome of a bulk create. CREATED = a new (or reactivated) row; EXISTS = the rate type was
 *  already active on the slot (skipped, never touched); ERROR = a bad reference (unknown rate type). */
export type BulkRateTypeAssignmentStatus = 'CREATED' | 'EXISTS' | 'ERROR';
export interface BulkRateTypeAssignmentRow {
  rateTypeId: number;
  status: BulkRateTypeAssignmentStatus;
  /** the created/reactivated assignment id, else null. */
  assignmentId: number | null;
  /** plain error code when status === 'ERROR', else null. */
  error: string | null;
}
export interface BulkRateTypeAssignmentResult {
  results: BulkRateTypeAssignmentRow[];
  createdCount: number;
  existsCount: number;
  errorCount: number;
}
