import { z } from 'zod';

/**
 * @crm2/sdk — the Rate contract (ADR-0016, flattened per owner direction). A rate IS a
 * service-zone rate: one row = (client, product, verification_unit, location[pincode+area],
 * free-text client_rate_type, amount). `location` is null for KYC units; `clientRateType` is free text the
 * user adds. Effective-dated: a revision inserts a new dated row; the prior is end-dated, never
 * overwritten. Mirrors migrations 0003 + 0012 + 0013 `rates`.
 */
export interface Rate {
  id: number;
  clientId: number;
  /** null ⇒ Universal — the rate applies to ALL products of the client (ADR-0071). */
  productId: number | null;
  /** null ⇒ Universal — the rate applies to ALL verification units of the client (ADR-0071). */
  verificationUnitId: number | null;
  locationId: number | null;
  clientRateType: string | null;
  amount: number;
  currency: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** OCC concurrency token (ADR-0019); sent back on update/revise/(de)activate. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A rate joined with the client / product / unit / location display fields (list view).
 *  product/unit codes+names are null for a Universal (NULL product/unit) rate (ADR-0071). */
export interface RateView extends Rate {
  clientCode: string;
  clientName: string;
  productCode: string | null;
  productName: string | null;
  unitCode: string | null;
  unitName: string | null;
  pincode: string | null;
  area: string | null;
}

/** One audit entry for a rate change (CREATE / REVISE / DEACTIVATE). */
export interface RateHistory {
  id: number;
  rateId: number | null;
  action: 'CREATE' | 'REVISE' | 'DEACTIVATE';
  oldAmount: number | null;
  newAmount: number | null;
  oldEffectiveTo: string | null;
  newEffectiveFrom: string | null;
  changedBy: string | null;
  changedAt: string;
}

const positiveInt = z.number().int().positive();
const money = z.number().nonnegative().max(99999999.99);
const isoDate = z.string().datetime();
const clientRateType = z.string().trim().min(1).max(60);

export const CreateRateSchema = z.object({
  clientId: positiveInt,
  /** null/absent ⇒ Universal — applies to ALL products of the client (ADR-0071). */
  productId: positiveInt.nullish(),
  /** null/absent ⇒ Universal — applies to ALL verification units of the client (ADR-0071). */
  verificationUnitId: positiveInt.nullish(),
  /** geography (a `locations` row = pincode+area); null/absent ⇒ no geography (e.g. KYC). */
  locationId: positiveInt.nullish(),
  /** rate-type catalog code (ADR-0068 FK server-side; Local, OGL, Outstation…); null/absent ⇒ none (e.g. KYC/office). */
  clientRateType: clientRateType.nullish(),
  amount: money,
  currency: z.string().length(3).default('INR'),
  /** when the rate takes effect; defaults to now server-side. */
  effectiveFrom: isoDate.optional(),
});

/** Revise = a new effective-dated version of an existing rate (old row is end-dated). */
export const ReviseRateSchema = z.object({
  amount: money,
  effectiveFrom: isoDate.optional(),
});

/** Update (legacy flat edit): only the price changes, overwriting in place. */
export const UpdateRateSchema = z.object({ amount: money });

export type CreateRateInput = z.input<typeof CreateRateSchema>;
export type ReviseRateInput = z.input<typeof ReviseRateSchema>;
export type UpdateRateInput = z.infer<typeof UpdateRateSchema>;

// ── Multi-location bulk entry ──────────────────────────────────────────────────────────────────
/** Max (pincode, area) locations per bulk save — mirrors the commission/CPV bulk caps. Exported so
 *  the create page can gate Save client-side instead of surfacing a raw zod 400. */
export const MAX_BULK_RATE_LOCATIONS = 500;

/**
 * Bulk rate create: ONE client bill-rate (the shared dims + amount) fanned across MANY (pincode,
 * area) locations — the server writes one rate row per location, identical to N single creates
 * (pure ergonomics; payout resolution unchanged, ADR-0050). Field/location-based only — an office
 * rate is location-less (single form), so `clientRateType` is REQUIRED here (ADR-0068 catalog code;
 * the server rejects unknown and OFFICE-category codes). `locationIds` are `locations` area ids.
 */
export const BulkCreateRatesSchema = z.object({
  clientId: positiveInt,
  /** null/absent ⇒ Universal — applies to ALL products of the client (ADR-0071). */
  productId: positiveInt.nullish(),
  /** null/absent ⇒ Universal — applies to ALL verification units of the client (ADR-0071). */
  verificationUnitId: positiveInt.nullish(),
  clientRateType: clientRateType,
  amount: money,
  currency: z.string().length(3).default('INR'),
  effectiveFrom: isoDate.optional(),
  locationIds: z.array(positiveInt).min(1).max(MAX_BULK_RATE_LOCATIONS),
});
export type BulkCreateRatesInput = z.input<typeof BulkCreateRatesSchema>;

/** Per-location outcome. CREATED = new row; EXISTS = an active rate already overlaps (skipped, NOT
 *  overwritten); ERROR = rejected (HAS_OTHER_RATE_TYPE | INVALID_REFERENCE). */
export type BulkRateStatus = 'CREATED' | 'EXISTS' | 'ERROR';
export interface BulkRateRow {
  locationId: number;
  status: BulkRateStatus;
  /** the new rate id when status = CREATED, else null. */
  rateId: number | null;
  /** an error code when status = ERROR (HAS_OTHER_RATE_TYPE | INVALID_REFERENCE), else null. */
  error: string | null;
}
export interface BulkRateResult {
  results: BulkRateRow[];
  createdCount: number;
  existsCount: number;
  errorCount: number;
}
