/**
 * @crm2/sdk — DPDP consent (mobile parity). The field app records the agent's acceptance of the
 * privacy-policy version (on accept + every login, best-effort, idempotent per user+version).
 */
import { z } from 'zod';

/** POST /api/v2/consents/accept body — the accepted privacy-policy version. */
export const AcceptConsentSchema = z.object({
  policyVersion: z.number().int().positive(),
});
export type AcceptConsentInput = z.infer<typeof AcceptConsentSchema>;

export interface ConsentAcceptance {
  id: string;
  policyVersion: number;
  acceptedAt: string;
}

export interface ConsentAcceptResult {
  success: boolean;
  data: ConsentAcceptance;
}
