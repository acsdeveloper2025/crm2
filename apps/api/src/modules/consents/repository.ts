import { query } from '../../platform/db.js';
import type { ConsentAcceptance } from '@crm2/sdk';

/**
 * DPDP consent persistence (mobile parity). Idempotent UPSERT per (user, policy_version): a re-accept
 * (every login) refreshes the timestamp/ip/UA without creating a duplicate row.
 */
export const consentRepository = {
  async accept(
    userId: string,
    policyVersion: number,
    ip: string | null,
    userAgent: string | null,
  ): Promise<ConsentAcceptance> {
    const rows = await query<ConsentAcceptance>(
      `INSERT INTO consents (user_id, policy_version, ip, user_agent)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, policy_version)
         DO UPDATE SET accepted_at = now(), ip = EXCLUDED.ip, user_agent = EXCLUDED.user_agent
       RETURNING id, policy_version, accepted_at`,
      [userId, policyVersion, ip, userAgent],
    );
    const row = rows[0];
    if (!row) throw new Error('consent upsert produced no row');
    return row;
  },
};
