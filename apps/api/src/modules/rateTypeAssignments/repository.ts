import type { RateTypeAssignment } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const FK_VIOLATION = '23503';

// Assignment columns mapped to camelCase + the two joined rate_types display columns.
const COLS = `a.id, a.client_id AS "clientId", a.product_id AS "productId",
  a.verification_unit_id AS "verificationUnitId", a.rate_type_id AS "rateTypeId",
  rt.code AS "rateTypeCode", rt.name AS "rateTypeName",
  a.is_active AS "isActive", a.created_by AS "createdBy", a.updated_by AS "updatedBy",
  a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

/** Minimal query shape — same structural type the platform `query`/`TxQuery` satisfy. */
type QueryFn = <T>(text: string, params?: unknown[]) => Promise<T[]>;

const listForComboWith = (
  q: QueryFn,
  clientId: number,
  productId: number,
  unitId: number,
): Promise<RateTypeAssignment[]> =>
  q<RateTypeAssignment>(
    `SELECT ${COLS}
       FROM rate_type_assignments a
       JOIN rate_types rt ON rt.id = a.rate_type_id
      WHERE a.client_id = $1 AND a.product_id = $2 AND a.verification_unit_id = $3 AND a.is_active
      ORDER BY rt.sort_order, rt.code`,
    [clientId, productId, unitId],
  );

export const rateTypeAssignmentRepository = {
  /** Active assignments for a (client × product × verification_unit) combo (display-joined). */
  listForCombo(clientId: number, productId: number, unitId: number): Promise<RateTypeAssignment[]> {
    return listForComboWith(query, clientId, productId, unitId);
  },

  /**
   * Replace the ACTIVE assigned rate-type set for a combo (ADR-0067, Phase B): upsert+activate the
   * listed ids, deactivate the rest. An empty `rateTypeIds` clears the combo. One audit row.
   */
  async bulkSet(
    clientId: number,
    productId: number,
    unitId: number,
    rateTypeIds: number[],
    userId: string,
  ): Promise<RateTypeAssignment[]> {
    try {
      return await withTransaction(async (q) => {
        for (const rateTypeId of rateTypeIds) {
          await q(
            `INSERT INTO rate_type_assignments
               (client_id, product_id, verification_unit_id, rate_type_id, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5)
             ON CONFLICT (client_id, product_id, verification_unit_id, rate_type_id)
             DO UPDATE SET is_active = true, updated_by = $5, updated_at = now()`,
            [clientId, productId, unitId, rateTypeId, userId],
          );
        }
        await q(
          `UPDATE rate_type_assignments
              SET is_active = false, updated_by = $4, updated_at = now()
            WHERE client_id = $1 AND product_id = $2 AND verification_unit_id = $3
              AND is_active AND NOT (rate_type_id = ANY($5::int[]))`,
          [clientId, productId, unitId, userId, rateTypeIds],
        );
        // One immutable audit row capturing the combo + resulting active set. 'BULK_SET' is not a
        // valid AuditAction (audit_log CHECK + the AuditAction union) → recorded as UPDATE.
        await appendAudit(
          {
            entityType: 'rate_type_assignments',
            entityId: unitId,
            action: 'UPDATE',
            actorId: userId,
            after: { clientId, productId, verificationUnitId: unitId, rateTypeIds },
          },
          q,
        );
        return await listForComboWith(q, clientId, productId, unitId);
      });
    } catch (e) {
      if (pgCode(e) === FK_VIOLATION)
        throw AppError.badRequest(
          'INVALID_ASSIGNMENT_REF',
          'unknown client, product, verification unit, or rate type',
        );
      throw e;
    }
  },
};
