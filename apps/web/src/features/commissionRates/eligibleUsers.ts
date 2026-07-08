// Commission resolves via commission_rates.user_id = case_tasks.assigned_to (billing
// COMMISSION_LATERAL), and only FIELD_AGENT/KYC_VERIFIER can ever be a task assignee
// (ADR-0024/0073). A commission rate for any other role can never match a task, so it's a
// guaranteed-dead row — owner decision 2026-07-08.
export const COMMISSION_ELIGIBLE_ROLES = ['FIELD_AGENT', 'KYC_VERIFIER'] as const;

export function commissionEligibleUsers<T extends { role: string }>(users: T[]): T[] {
  return users.filter((u) => (COMMISSION_ELIGIBLE_ROLES as readonly string[]).includes(u.role));
}
