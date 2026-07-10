import { z } from 'zod';
import { toUpper } from './text.js';

// ADR-0068: fieldRateType accepts any active rate_types catalog code (uppercased/trimmed), not just the
// LOCAL/OGL/OFFICE enum. The FK + the repo's code→id lookup enforce validity (unknown code ⇒ NULL id).
// COMMISSION_RATE_TYPES still lives in (and is exported from) ./cases.js for its other consumers.

/**
 * @crm2/sdk — the Commission Rate contract (ADR-0036, billing slice 5a). One row =
 * (user, field_rate_type, client[nullable = universal], amount) — the per-user agent-commission amount
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
  fieldRateType: string | null;
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

/**
 * ADR-0050: a commission tariff line. Three dimensions are REQUIRED-specific — `userId`, `locationId`
 * (a `locations` area id), and `fieldRateType` (the trip band LOCAL|OGL, re-coupled as a resolution key
 * matching the task's `field_field_rate_type`). Four dimensions support **Universal** (null = matches any):
 * `clientId`, `productId`, `verificationUnitId`, `tatBand`. The resolver picks the MOST-SPECIFIC
 * matching row, priority Client > Product > Unit > TAT band. `effectiveFrom` is optional (temporal).
 */
export const CreateCommissionRateSchema = z
  .object({
    userId: uuid,
    /** client dimension; null/absent ⇒ Universal (all clients). */
    clientId: positiveInt.nullish(),
    /** product dimension; null/absent ⇒ Universal (all products). */
    productId: positiveInt.nullish(),
    /** verification-unit dimension; null/absent ⇒ Universal (all units). */
    verificationUnitId: positiveInt.nullish(),
    /** executive location dimension — a `locations` area id. REQUIRED for LOCAL/OGL; OPTIONAL for OFFICE
     *  (a flat office rate has no location, ADR-0050). */
    locationId: positiveInt.nullish(),
    /** the field rate type — resolution key matching the task's `field_rate_type`. Any active
     *  rate_types catalog code (LOCAL/OGL for field work, OFFICE for desk/KYC, or an admin-defined
     *  code); uppercased/trimmed. The FK + repo lookup enforce validity (ADR-0068). */
    fieldRateType: z.string().trim().min(1).max(40).transform(toUpper),
    /** completed-in TAT band: tat_hours, -1 (out of band), or null/absent ⇒ Universal (any band). */
    tatBand: z.number().int().nullish(),
    amount: money,
    currency: z.string().length(3).default('INR'),
    /** when the rate takes effect; defaults to now server-side. */
    effectiveFrom: isoDate.optional(),
  })
  .refine((v) => v.fieldRateType === 'OFFICE' || !!v.locationId, {
    message: 'locationId is required for a LOCAL/OGL commission rate (OFFICE is location-less)',
    path: ['locationId'],
  });

/** Revise = a new effective-dated version of an existing commission rate (old row is end-dated). */
export const ReviseCommissionRateSchema = z.object({
  amount: money,
  effectiveFrom: isoDate.optional(),
});

export type CreateCommissionRateInput = z.input<typeof CreateCommissionRateSchema>;
export type ReviseCommissionRateInput = z.input<typeof ReviseCommissionRateSchema>;

// ── Multi-location bulk entry ──────────────────────────────────────────────────────────────────
/** Max (pincode, area) locations per bulk save — mirrors the scope-assignment / CPV bulk caps. */
const MAX_BULK_LOCATIONS = 500;

/**
 * Bulk commission-rate create: ONE field agent + ONE rate (the shared dims + amount) fanned across
 * MANY of the agent's assigned (pincode, area) locations — the server writes one commission-rate row
 * per location, identical to N single creates (pure ergonomics; payout resolution unchanged, ADR-0050).
 * Field/location-based only — OFFICE is location-less (single form). `locationIds` are `locations` area
 * ids and MUST be within the agent's territory (the server re-checks; the picker is already scoped).
 */
export const BulkCreateCommissionRatesSchema = z.object({
  userId: uuid,
  clientId: positiveInt.nullish(),
  productId: positiveInt.nullish(),
  verificationUnitId: positiveInt.nullish(),
  fieldRateType: z.string().trim().min(1).max(40).transform(toUpper),
  tatBand: z.number().int().nullish(),
  amount: money,
  currency: z.string().length(3).default('INR'),
  effectiveFrom: isoDate.optional(),
  locationIds: z.array(positiveInt).min(1).max(MAX_BULK_LOCATIONS),
});
export type BulkCreateCommissionRatesInput = z.input<typeof BulkCreateCommissionRatesSchema>;

/** Per-location outcome. CREATED = new row; EXISTS = an active rate already overlaps (skipped, NOT
 *  overwritten); ERROR = rejected (NOT_IN_TERRITORY | INVALID_REFERENCE). */
export type BulkCommissionRateStatus = 'CREATED' | 'EXISTS' | 'ERROR';
export interface BulkCommissionRateRow {
  locationId: number;
  status: BulkCommissionRateStatus;
  /** the new rate id when status = CREATED, else null. */
  rateId: number | null;
  /** an error code when status = ERROR (NOT_IN_TERRITORY | INVALID_REFERENCE), else null. */
  error: string | null;
}
export interface BulkCommissionRateResult {
  results: BulkCommissionRateRow[];
  createdCount: number;
  existsCount: number;
  errorCount: number;
}
