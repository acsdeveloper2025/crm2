import { query } from '../../platform/db.js';
import type { VerificationTypeOutcome, RevokeReason } from '@crm2/sdk';

/**
 * Mobile reference masters (mobile parity): per-type field outcomes + revoke reasons. Static lookup
 * data seeded in migration 0069; camelize() bridges snake→camel for the device's row contract.
 */
export const referenceRepository = {
  /** Active outcomes for every verification type, ordered by type then sort_order (v1 order). */
  async listOutcomes(): Promise<VerificationTypeOutcome[]> {
    return query<VerificationTypeOutcome>(
      `SELECT id, verification_type_id, verification_type_code, outcome_code,
              display_label, sort_order, is_active
       FROM verification_unit_outcomes
       WHERE is_active = true
       ORDER BY verification_type_id, sort_order`,
    );
  },

  /** Active revoke reasons, ordered by sort_order. */
  async listRevokeReasons(): Promise<RevokeReason[]> {
    return query<RevokeReason>(
      `SELECT id, code, label, sort_order, is_active
       FROM revoke_reasons
       WHERE is_active = true
       ORDER BY sort_order, id`,
    );
  },
};
