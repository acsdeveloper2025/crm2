import { z } from 'zod';

/** @crm2/sdk — Policy acceptance (ADR-0042). Admin-managed, versioned policies a user must accept
 *  at login. `contentVersion` drives re-acceptance; `version` is the OCC token (ADR-0019). */
export interface Policy {
  id: number;
  code: string;
  name: string;
  description: string | null;
  content: string;
  contentVersion: number;
  isActive: boolean;
  effectiveFrom: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The minimal shape the login gate sends the client for a policy awaiting acceptance. */
export interface PendingPolicy {
  id: number;
  code: string;
  name: string;
  content: string;
  contentVersion: number;
}

export interface PolicyAcceptance {
  id: number;
  userId: string;
  policyId: number;
  contentVersion: number;
  source: 'WEB' | 'MOBILE';
  acceptedAt: string;
}

const codeField = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'code must be UPPER_SNAKE');

export const CreatePolicySchema = z.object({
  code: codeField,
  name: z.string().min(1),
  description: z.string().nullish(),
  content: z.string().min(1),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;

/** Update: every field optional; `version` (OCC) required is enforced server-side. */
export const UpdatePolicySchema = z
  .object({
    code: codeField,
    name: z.string().min(1),
    description: z.string().nullish(),
    content: z.string().min(1),
  })
  .partial();
export type UpdatePolicyInput = z.infer<typeof UpdatePolicySchema>;

export const PolicyEffectiveFromSchema = z.object({ effectiveFrom: z.string().datetime().optional() });

/** Self-service acceptance: the user accepts a set of pending policy ids. Source defaults to WEB. */
export const AcceptPoliciesSchema = z.object({
  policyIds: z.array(z.number().int().positive()).min(1),
  source: z.enum(['WEB', 'MOBILE']).default('WEB'),
});
export type AcceptPoliciesInput = z.input<typeof AcceptPoliciesSchema>;
