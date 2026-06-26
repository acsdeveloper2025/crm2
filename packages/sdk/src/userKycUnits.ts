import { z } from 'zod';

/**
 * @crm2/sdk — per-user KYC-unit ASSIGNMENT ELIGIBILITY (ADR-0073). A KYC verifier is granted specific KYC
 * units; an OFFICE task is assignable only to KYC users granted that task's unit. This is eligibility ONLY —
 * NOT visibility (KYC verifiers stay SELF-scoped; the grant never reaches the scope resolver).
 */
export interface KycUnitOption {
  id: number;
  code: string;
  name: string;
}

/** The grant editor payload: the user's currently-granted unit ids + the assignable KYC units. */
export interface UserKycUnits {
  grantedUnitIds: number[];
  availableUnits: KycUnitOption[];
}

/** Set-the-set: replace the user's grants with exactly `unitIds` (activate these, deactivate the rest). */
export const SetKycUnitsSchema = z.object({
  unitIds: z.array(z.number().int().positive()),
});
export type SetKycUnitsInput = z.infer<typeof SetKycUnitsSchema>;
