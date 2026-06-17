import { z } from 'zod';
import type { ReportLayoutDetail } from './reportLayouts.js';

/**
 * @crm2/sdk — office data-entry contract (ADR-0037, MIS engine slice 3). For a CASE, the office
 * operator keys the structured MIS fields once against the case's (client,product) active DATA_ENTRY
 * layout — Zion `NewDataQC` keys these per case, not per task. The form read returns that layout (null
 * when none is configured for the case's client+product) + the case's current keyed values (null until
 * first saved); values are a map keyed by the layout column_key.
 */
export interface CaseDataEntry {
  caseId: string;
  layout: ReportLayoutDetail | null;
  entry: { id: number; data: Record<string, unknown>; version: number } | null;
}

/** Save the keyed values. `version` is the OCC token for an existing entry (omitted on first save). */
export const SaveDataEntrySchema = z.object({
  data: z.record(z.string(), z.unknown()),
  version: z.number().int().min(0).optional(),
});
export type SaveDataEntryInput = z.input<typeof SaveDataEntrySchema>;

/**
 * Pickup Information (ADR-0037) — Zion `NewDataQC`'s FIXED per-case office box (same fields for every
 * client, unlike the config-driven DATA_ENTRY layout). `pickupForDocuments` (the case's verification
 * units) and `bankName` (the client) are DERIVED read-only; `timeOfVerificationDays`
 * (reported − pickup, in days) is COMPUTED; the rest are keyed. One pickup row per case.
 */
export interface CasePickup {
  caseId: string;
  pickupForDocuments: string;
  bankName: string;
  timeOfVerificationDays: number | null;
  pickup: {
    id: number;
    pickupDate: string | null;
    reportedDate: string | null;
    pickupTrigger: string | null;
    samplerName: string | null;
    visitDateTime: string | null;
    version: number;
  } | null;
}

/** Save the pickup fields (ISO datetimes; null clears). `version` is the OCC token once a row exists. */
const isoDateNullish = z.string().datetime().nullish();
export const SavePickupSchema = z.object({
  pickupDate: isoDateNullish,
  reportedDate: isoDateNullish,
  pickupTrigger: z.string().trim().max(200).nullish(),
  samplerName: z.string().trim().max(200).nullish(),
  visitDateTime: isoDateNullish,
  version: z.number().int().min(0).optional(),
});
export type SavePickupInput = z.input<typeof SavePickupSchema>;
