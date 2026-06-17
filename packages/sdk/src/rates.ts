import { z } from 'zod';

/**
 * @crm2/sdk — the Rate contract (ADR-0016, flattened per owner direction). A rate IS a
 * service-zone rate: one row = (client, product, verification_unit, location[pincode+area],
 * free-text rate_type, amount). `location` is null for KYC units; `rateType` is free text the
 * user adds. Effective-dated: a revision inserts a new dated row; the prior is end-dated, never
 * overwritten. Mirrors migrations 0003 + 0012 + 0013 `rates`.
 */
export interface Rate {
  id: number;
  clientId: number;
  productId: number;
  verificationUnitId: number;
  locationId: number | null;
  rateType: string | null;
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

/** A rate joined with the client / product / unit / location display fields (list view). */
export interface RateView extends Rate {
  clientCode: string;
  clientName: string;
  productCode: string;
  productName: string;
  unitCode: string;
  unitName: string;
  unitKind: string;
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
const rateType = z.string().trim().min(1).max(60);

export const CreateRateSchema = z.object({
  clientId: positiveInt,
  productId: positiveInt,
  verificationUnitId: positiveInt,
  /** geography (a `locations` row = pincode+area); null/absent ⇒ no geography (e.g. KYC). */
  locationId: positiveInt.nullish(),
  /** free-text tier label the user types (Local, OGL, Outstation…); null/absent ⇒ none. */
  rateType: rateType.nullish(),
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
