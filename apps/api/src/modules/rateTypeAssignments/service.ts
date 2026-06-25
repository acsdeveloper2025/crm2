import { BulkSetRateTypeAssignmentsSchema, type RateTypeAssignment } from '@crm2/sdk';
import { rateTypeAssignmentRepository as repo } from './repository.js';
import { posIntParam } from '../rateTypes/service.js';

/** An OPTIONAL positive-int query param → its value, or null when omitted/blank (= Universal / NULL).
 *  A present-but-invalid value (non-int, ≤0) still 400s — only absence means Universal (ADR-0069). */
const optPosIntParam = (q: Record<string, unknown>, name: string): number | null => {
  const raw = q[name];
  if (raw === undefined || raw === '' || raw === null) return null;
  return posIntParam(q, name);
};

/** Rate-type assignment service (ADR-0067 / ADR-0069) — which rate types a combo may use. */
export const rateTypeAssignmentService = {
  /** Active assignments for a (client × product|Universal) across all units (the page groups by unit;
   *  productId omitted/blank = Universal/NULL). clientId is required. */
  listForClientProduct(rawQuery: Record<string, unknown>): Promise<RateTypeAssignment[]> {
    const clientId = posIntParam(rawQuery, 'clientId');
    const productId = optPosIntParam(rawQuery, 'productId');
    return repo.listForClientProduct(clientId, productId);
  },

  /** Replace the active rate-type set for a combo (empty array clears it). product/unit may be
   *  Universal (null) — `?? null` normalizes the now-nullable schema fields. */
  bulkSet(body: unknown, userId: string): Promise<RateTypeAssignment[]> {
    const v = BulkSetRateTypeAssignmentsSchema.parse(body); // throws ZodError → 400
    return repo.bulkSet(v.clientId, v.productId ?? null, v.verificationUnitId ?? null, v.rateTypeIds, userId);
  },
};
