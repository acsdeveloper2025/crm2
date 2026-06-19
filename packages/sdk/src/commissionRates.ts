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
  /**
   * Optional executive classification label (LOCAL/OGL/OUTSTATION — descriptive only).
   * No longer a resolution key (ADR-0046): the resolver is decoupled from the client rate.
   */
  rateType: string | null;
  /** null ⇒ universal (applies to every client) for this user. */
  clientId: number | null;
  /** executive's location dimension; null ⇒ applies to any location (ADR-0046). */
  locationId: number | null;
  /** product dimension; null ⇒ applies to any product (ADR-0046). */
  productId: number | null;
  /** verification-unit dimension; null ⇒ applies to any unit (ADR-0046). */
  verificationUnitId: number | null;
  /** completed-in TAT band: tat_hours, or -1 (overflow / out-of-band), or null ⇒ any band (ADR-0046). */
  tatBand: number | null;
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

/** A commission rate joined with the user / client / dimension display fields (list view). */
export interface CommissionRateView extends CommissionRate {
  userName: string;
  userEmail: string | null;
  /** null when the rate is universal (clientId null). */
  clientCode: string | null;
  clientName: string | null;
  /** null when the rate applies to any product (productId null). */
  productCode: string | null;
  productName: string | null;
  /** null when the rate applies to any verification unit (verificationUnitId null). */
  verificationUnitName: string | null;
  /** location display fields; null when the rate applies to any location (locationId null). */
  pincode: string | null;
  area: string | null;
}

const positiveInt = z.number().int().positive();
const money = z.number().nonnegative().max(9999999999.99);
const isoDate = z.string().datetime();
const uuid = z.string().uuid();
const rateType = z.string().trim().min(1).max(60);

export const CreateCommissionRateSchema = z.object({
  userId: uuid,
  /**
   * optional executive classification label (LOCAL/OGL/OUTSTATION — descriptive only).
   * No longer required nor used in resolution (ADR-0046).
   */
  rateType: rateType.nullish(),
  /** client this commission is scoped to; null/absent ⇒ universal (every client). */
  clientId: positiveInt.nullish(),
  /** executive location dimension; null/absent ⇒ applies to any location (ADR-0046). */
  locationId: positiveInt.nullish(),
  /** product dimension; null/absent ⇒ applies to any product (ADR-0046). */
  productId: positiveInt.nullish(),
  /** verification-unit dimension; null/absent ⇒ applies to any unit (ADR-0046). */
  verificationUnitId: positiveInt.nullish(),
  /** completed-in TAT band: tat_hours, -1 (overflow), or null/absent ⇒ any band (ADR-0046). */
  tatBand: z.number().int().nullish(),
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
