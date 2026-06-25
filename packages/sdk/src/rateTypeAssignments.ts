import { z } from 'zod';

/** A single (client × product × verification_unit → rate_type) availability row (ADR-0067, Phase B). */
export interface RateTypeAssignment {
  id: number;
  clientId: number;
  productId: number;
  verificationUnitId: number;
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

const MAX_BATCH = 500; // checkbox set is a handful of catalog rows; cap for parity with sibling schemas
const MAX_PG_INT = 2147483647; // int4 — ids above this are a pg 22003, not a clean 400
const posInt = z.number().int().positive().max(MAX_PG_INT);

/**
 * Replace the ACTIVE assigned rate-type set for a combo. An empty `rateTypeIds` clears the combo
 * (deactivates all its assignments). The server upserts+activates the listed ids and deactivates the rest.
 */
export const BulkSetRateTypeAssignmentsSchema = z.object({
  clientId: posInt,
  productId: posInt,
  verificationUnitId: posInt,
  // No `.min(1)` — an empty array intentionally clears the combo. `.max` mirrors the sibling array schemas.
  rateTypeIds: z.array(posInt).max(MAX_BATCH),
});

export type BulkSetRateTypeAssignmentsInput = z.infer<typeof BulkSetRateTypeAssignmentsSchema>;
