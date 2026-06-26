import { z } from 'zod';

/**
 * @crm2/sdk — the CPV (Client · Product · Verification-unit) enablement contract.
 * Two entities form the enablement graph that gates case creation:
 *  - `client_products`                     : a product enabled for a client (migration 0002)
 *  - `client_product_verification_units`   : a verification unit enabled for a client+product (migration 0001)
 */

export interface ClientProduct {
  id: number;
  clientId: number;
  productId: number;
  isActive: boolean;
  /** when the link becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019); required on every (de)activate. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A client_product row joined with the client + product display fields (list view). */
export interface ClientProductView extends ClientProduct {
  clientCode: string;
  clientName: string;
  productCode: string;
  productName: string;
  /** count of currently-active enabled verification units on this link (for discoverability). */
  unitCount: number;
}

export interface ClientProductVerificationUnit {
  id: number;
  clientProductId: number;
  /** null ⇒ Universal — all units are enabled for this client+product (ADR-0074). */
  verificationUnitId: number | null;
  isActive: boolean;
  /** when the enablement becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019); required on every (de)activate. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A CPV-unit row joined with the verification-unit display fields (list view).
 *  unit codes/name/role are null for a Universal (NULL unit) mapping — render "Universal" (ADR-0074). */
export interface ClientProductVerificationUnitView extends ClientProductVerificationUnit {
  unitCode: string | null;
  unitName: string | null;
  unitWorkerRole: string | null;
}

const positiveInt = z.number().int().positive();
const isoDate = z.string().datetime();

export const CreateClientProductSchema = z.object({
  clientId: positiveInt,
  productId: positiveInt,
  /** optional; defaults to now() server-side (ADR-0017). */
  effectiveFrom: isoDate.optional(),
});

export const CreateCpvUnitSchema = z.object({
  clientProductId: positiveInt,
  /** null/absent ⇒ Universal — enables ALL units for this client+product (ADR-0074). */
  verificationUnitId: positiveInt.nullish(),
  /** optional; defaults to now() server-side (ADR-0017). */
  effectiveFrom: isoDate.optional(),
});

/** Reschedule the effective-from of a link / unit-enablement (the only mutable field; keys are immutable). */
export const UpdateClientProductSchema = z.object({ effectiveFrom: isoDate });
export const UpdateCpvUnitSchema = z.object({ effectiveFrom: isoDate });

export type CreateClientProductInput = z.infer<typeof CreateClientProductSchema>;
export type CreateCpvUnitInput = z.infer<typeof CreateCpvUnitSchema>;
export type UpdateClientProductInput = z.infer<typeof UpdateClientProductSchema>;
export type UpdateCpvUnitInput = z.infer<typeof UpdateCpvUnitSchema>;

export interface CpvUnitListQuery {
  clientProductId: number;
  active?: boolean;
}
