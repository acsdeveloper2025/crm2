/**
 * @crm2/sdk — mobile reference masters (mobile parity). Server-driven lookup feeds the field app
 * refreshes each sync cycle: per-verification-type field outcomes + revoke reasons. Returned in the
 * v1 `{ success, data }` envelope the device reads (`res.data`). Own-feed-agnostic (no user scope) —
 * static catalog any authenticated user may read. Numeric `id` matches the device's local mirror.
 */

/** One valid field outcome for a verification type (TaskRevokeModal / form outcome dropdown). */
export interface VerificationTypeOutcome {
  id: number;
  /** Mirrors the v1 numeric verification-type id (device ordering/shape contract). */
  verificationTypeId: number;
  /** The v2 unit code the device matches a task on (= sync DTO `verificationUnit.code`). */
  verificationTypeCode: string;
  /** Wire enum (UPPERCASE): POSITIVE, SHIFTED, NSP, ENTRY_RESTRICTED, UNTRACEABLE, NEGATIVE. */
  outcomeCode: string;
  /** UI label, e.g. "No Such Person". */
  displayLabel: string;
  sortOrder: number;
  isActive: boolean;
}

export interface VerificationTypeOutcomeList {
  success: boolean;
  data: VerificationTypeOutcome[];
}

/** A field revoke reason (the device's revoke-task dropdown). */
export interface RevokeReason {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export interface RevokeReasonList {
  success: boolean;
  data: RevokeReason[];
}
