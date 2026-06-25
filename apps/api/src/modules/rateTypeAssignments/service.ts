import { BulkSetRateTypeAssignmentsSchema, type RateTypeAssignment } from '@crm2/sdk';
import { rateTypeAssignmentRepository as repo } from './repository.js';
import { posIntParam } from '../rateTypes/service.js';

/** Rate-type assignment service (ADR-0067, Phase B) — which rate types a combo may use. */
export const rateTypeAssignmentService = {
  /** Active assignments for the (client × product × verification_unit) combo in the query. */
  listForCombo(rawQuery: Record<string, unknown>): Promise<RateTypeAssignment[]> {
    const clientId = posIntParam(rawQuery, 'clientId');
    const productId = posIntParam(rawQuery, 'productId');
    const unitId = posIntParam(rawQuery, 'verificationUnitId');
    return repo.listForCombo(clientId, productId, unitId);
  },

  /** Replace the active rate-type set for a combo (empty array clears it). */
  bulkSet(body: unknown, userId: string): Promise<RateTypeAssignment[]> {
    const v = BulkSetRateTypeAssignmentsSchema.parse(body); // throws ZodError → 400
    return repo.bulkSet(v.clientId, v.productId, v.verificationUnitId, v.rateTypeIds, userId);
  },
};
