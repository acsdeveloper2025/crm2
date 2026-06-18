import type { VerificationTypeOutcomeList, RevokeReasonList } from '@crm2/sdk';
import { referenceRepository as repo } from './repository.js';

/**
 * Reference masters the field app refreshes each sync cycle (ADR-0012 mobile parity). Wrapped in the
 * v1 `{ success, data }` envelope the device reads. No user scope — static catalog for any authenticated user.
 */
export const referenceService = {
  async verificationTypeOutcomes(): Promise<VerificationTypeOutcomeList> {
    return { success: true, data: await repo.listOutcomes() };
  },

  async revokeReasons(): Promise<RevokeReasonList> {
    return { success: true, data: await repo.listRevokeReasons() };
  },
};
