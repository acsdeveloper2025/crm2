import type { UserKycUnits, KycUnitOption } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';

/**
 * Per-user KYC-unit grants (ADR-0073). Read ONLY by the assignee-eligibility pool functions
 * (cases/tasks repositories) — NEVER by the scope/visibility resolver. Deactivate (is_active=false),
 * never delete, on revoke.
 */
export const userKycUnitsRepository = {
  /** A user's active grants + the assignable KYC units (active, worker_role KYC_VERIFIER). */
  async forUser(userId: string): Promise<UserKycUnits> {
    const granted = await query<{ verificationUnitId: number }>(
      `SELECT verification_unit_id AS "verificationUnitId" FROM user_kyc_unit_access
       WHERE user_id = $1 AND is_active ORDER BY verification_unit_id`,
      [userId],
    );
    // ANY active verification unit is grantable (field OR office) — a KYC verifier can be OFFICE-assigned a
    // task at any unit (ADR-0070 decoupled visit type from the unit), so the grant is unit-agnostic.
    const availableUnits = await query<KycUnitOption>(
      `SELECT id, code, name FROM verification_units
       WHERE is_active AND effective_from <= now()
       ORDER BY sort_order, name`,
    );
    return { grantedUnitIds: granted.map((r) => r.verificationUnitId), availableUnits };
  },

  /** The role that works OFFICE tasks (data-driven via assignment_pool_roles — no role-name literal). */
  async officePoolRole(): Promise<string | null> {
    const rows = await query<{ roleCode: string }>(
      `SELECT role_code AS "roleCode" FROM assignment_pool_roles WHERE visit_type = 'OFFICE'`,
    );
    return rows[0]?.roleCode ?? null;
  },

  /** Replace the user's grants with exactly `unitIds`: activate the listed, deactivate the rest. Idempotent. */
  async setForUser(userId: string, unitIds: number[], actorId: string): Promise<void> {
    await withTransaction(async (q) => {
      await q(
        `UPDATE user_kyc_unit_access SET is_active = false
         WHERE user_id = $1 AND is_active AND NOT (verification_unit_id = ANY($2::int[]))`,
        [userId, unitIds],
      );
      if (unitIds.length > 0)
        await q(
          `INSERT INTO user_kyc_unit_access (user_id, verification_unit_id, created_by)
           SELECT $1, u, $3 FROM unnest($2::int[]) AS u
           ON CONFLICT (user_id, verification_unit_id) DO UPDATE SET is_active = true`,
          [userId, unitIds, actorId],
        );
    });
  },

  /** The user's role (to gate grants to KYC verifiers); null if the user doesn't exist. */
  async roleOf(userId: string): Promise<string | null> {
    const rows = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [userId]);
    return rows[0]?.role ?? null;
  },
};
