import { z } from 'zod';

/**
 * @crm2/sdk — the Commission Rate contract (ADR-0036, billing slice 5a). One row =
 * (user, rate_type, client[nullable = universal], amount) — the per-user agent-commission amount
 * source for the unified Billing & Commission view. v1-parity with field_user_commission_assignments,
 * but ANY user may hold rates (the gate is "any COMPLETED task earns if its assignee has a matching
 * rate"). Resolution is most-specific-client-wins (a client-scoped row beats a universal one) +
 * temporal + is_active. Effective-dated: a revision inserts a new dated row; the prior is end-dated,
 * never overwritten. Mirrors migration 0058 `commission_rates`.
 */
export interface CommissionRate {
  id: number;
  userId: string;
  rateType: string;
  /** null ⇒ universal (applies to every client) for this user+rate_type. */
  clientId: number | null;
  amount: number;
  currency: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** OCC concurrency token (ADR-0019); sent back on revise/(de)activate. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A commission rate joined with the user / client display fields (list view). */
export interface CommissionRateView extends CommissionRate {
  userName: string;
  userEmail: string | null;
  /** null when the rate is universal (clientId null). */
  clientCode: string | null;
  clientName: string | null;
}

const positiveInt = z.number().int().positive();
const money = z.number().nonnegative().max(9999999999.99);
const isoDate = z.string().datetime();
const uuid = z.string().uuid();
const rateType = z.string().trim().min(1).max(60);

export const CreateCommissionRateSchema = z.object({
  userId: uuid,
  /** the rate tier this commission applies to (matches a rates.rate_type code: LOCAL/OGL/…). */
  rateType,
  /** client this commission is scoped to; null/absent ⇒ universal (every client). */
  clientId: positiveInt.nullish(),
  amount: money,
  currency: z.string().length(3).default('INR'),
  /** when the rate takes effect; defaults to now server-side. */
  effectiveFrom: isoDate.optional(),
});

/** Revise = a new effective-dated version of an existing commission rate (old row is end-dated). */
export const ReviseCommissionRateSchema = z.object({
  amount: money,
  effectiveFrom: isoDate.optional(),
});

export type CreateCommissionRateInput = z.input<typeof CreateCommissionRateSchema>;
export type ReviseCommissionRateInput = z.input<typeof ReviseCommissionRateSchema>;
