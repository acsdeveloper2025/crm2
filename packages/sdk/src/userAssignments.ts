import { z } from 'zod';

/**
 * @crm2/sdk — generic user scope assignments (ADR-0022). ONE contract for every dimension
 * (CLIENT / PRODUCT / PINCODE / AREA — ADR-0072 removed STATE/CITY/VERIFICATION_TYPE): which dimensions a
 * user may hold is governed by their role's admin-edited wiring, not by this contract. ID-kind
 * dimensions reference a catalog row id; the contract retains VALUE-kind (text value) support, latent.
 */
export interface ScopeAssignmentItem {
  /** the assignment row id (the DELETE handle). */
  id: number;
  entityId: number | null;
  entityValue: string | null;
  /** display label resolved from the dimension's catalog (or the value itself). */
  label: string;
}

/** dimension code → that dimension's assignments (only dimensions with rows appear). */
export type UserScopeAssignments = Record<string, ScopeAssignmentItem[]>;

const MAX_BATCH = 500;
const MAX_PG_INT = 2147483647; // int4 — ids above this would be a pg 22003, not a 400

export const AssignScopeSchema = z
  .object({
    dimension: z.string().min(1).max(32),
    entityIds: z.array(z.number().int().positive().max(MAX_PG_INT)).min(1).max(MAX_BATCH).optional(),
    entityValues: z.array(z.string().min(1).max(200)).min(1).max(MAX_BATCH).optional(),
  })
  .refine((o) => (o.entityIds === undefined) !== (o.entityValues === undefined), {
    message: 'provide exactly one of entityIds or entityValues',
  });
export type AssignScopeInput = z.infer<typeof AssignScopeSchema>;
