import { z } from 'zod';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — the Location contract. A pincode-centric catalog row (pincode + area
 * + city + state). Mirrors crm2/db/v2/migrations/0004 `locations`.
 */
export interface Location {
  id: number;
  pincode: string;
  area: string;
  city: string;
  state: string;
  country: string;
  isActive: boolean;
  /** when the row becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019); sent back on update, bumped on every successful write. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const pincode = z.string().regex(/^[1-9][0-9]{5}$/, 'pincode must be 6 digits');
const area = z.string().min(1).max(255).transform(toUpper);
const city = z.string().min(1).max(100).transform(toUpper);
const state = z.string().min(1).max(100).transform(toUpper);
const country = z.string().min(1).max(100).transform(toUpper).default('India');
const isoDate = z.string().datetime();

export const CreateLocationSchema = z.object({
  pincode,
  area,
  city,
  state,
  country,
  effectiveFrom: isoDate.optional(),
});

/** Update: area/city/state/country/effectiveFrom editable; pincode correctable while unreferenced (ADR-0020). */
export const UpdateLocationSchema = z.object({
  // ADR-0020: pincode (the key) correctable only while unreferenced; locked (409 PINCODE_LOCKED) once in use.
  pincode: pincode.optional(),
  area,
  city,
  state,
  country,
  effectiveFrom: isoDate.optional(),
});

export type CreateLocationInput = z.input<typeof CreateLocationSchema>;
export type UpdateLocationInput = z.input<typeof UpdateLocationSchema>;

/**
 * Multi-area create — the v1 "add a pincode WITH its areas" workflow in the v2 flat model.
 * One request supplies the shared pincode/city/state/country once plus N area names; the server
 * inserts one `(pincode,area)` row per area (so the same pincode never drifts to a different
 * city/state across its areas). Already-existing `(pincode,area)` pairs are skipped, not aborted.
 */
export const CreateLocationBatchSchema = z.object({
  pincode,
  city,
  state,
  country,
  effectiveFrom: isoDate.optional(),
  areas: z.array(area).min(1).max(50),
});
export type CreateLocationBatchInput = z.input<typeof CreateLocationBatchSchema>;

export interface LocationBatchResult {
  created: Location[];
  /** areas not created because that `(pincode,area)` already exists (per-area, batch not aborted). */
  skipped: { area: string; reason: string }[];
}
