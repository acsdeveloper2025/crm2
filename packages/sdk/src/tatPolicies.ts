import { z } from 'zod';

import { toUpper } from './text.js';

/**
 * @crm2/sdk — the TAT Policy contract (ADR-0044). One row = a configurable turnaround-time band
 * (4/6/8/12/24/48h) used for target-TAT assignment AND completed-in-band classification. Effective-
 * dated + OCC like the other master data (commission_rates / rates): a revision inserts a new dated
 * row; the prior is end-dated, never overwritten. Mirrors migration 0077 `tat_policies`.
 */
export interface TatPolicy {
  id: number;
  tatHours: number;
  label: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** OCC concurrency token (ADR-0019); sent back on revise/(de)activate. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A TAT policy as listed (no joins — kept as an alias so the FE can name the list type). */
export type TatPolicyView = TatPolicy;

/** Slim active-band option for a target-TAT dropdown (ADR-0044). Read via `GET /tat-policies/options`
 *  (page.masterdata-gated, so case-creators can pick a TAT at task creation). */
export interface TatPolicyOption {
  id: number;
  tatHours: number;
  label: string;
}

export const CreateTatPolicySchema = z.object({
  tatHours: z.number().int().positive(),
  label: z.string().trim().min(1).max(40).transform(toUpper),
  /** when the band takes effect; defaults to now server-side. */
  effectiveFrom: z.string().optional(),
});

/** Revise = a new effective-dated version of an existing TAT policy (old row is end-dated). */
export const ReviseTatPolicySchema = z.object({
  label: z.string().trim().min(1).max(40).transform(toUpper),
  effectiveFrom: z.string().optional(),
});

export type CreateTatPolicyInput = z.input<typeof CreateTatPolicySchema>;
export type ReviseTatPolicyInput = z.input<typeof ReviseTatPolicySchema>;
