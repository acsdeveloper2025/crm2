import { AcceptConsentSchema, type ConsentAcceptResult } from '@crm2/sdk';
import { consentRepository as repo } from './repository.js';

/** DPDP consent (mobile parity). Records the agent's privacy-policy acceptance, idempotently. */
export const consentService = {
  async accept(
    userId: string,
    rawBody: unknown,
    ip: string | null,
    userAgent: string | null,
  ): Promise<ConsentAcceptResult> {
    const b = AcceptConsentSchema.parse(rawBody);
    return { success: true, data: await repo.accept(userId, b.policyVersion, ip, userAgent) };
  },
};
