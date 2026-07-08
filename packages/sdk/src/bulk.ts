/**
 * @crm2/sdk — the bulk-mutation contract (CONCURRENCY_AND_EDITING_STANDARD §1/§7; DATAGRID_STANDARD
 * §15 bulk actions). A bulk endpoint takes `{ items: [{ id, version }] }` and returns a per-row
 * result — every row is version-guarded (OCC), so a row changed since selection comes back as
 * CONFLICT, never a silent overwrite.
 */
import { z } from 'zod';

/** One row's bulk intent: which row, at which version the user started from. */
export interface BulkItem {
  id: string | number;
  version: number;
}

/** The request body for a bulk activate/deactivate (and future bulk mutations). */
export interface BulkRequest {
  items: BulkItem[];
}

export type BulkRowStatus = 'OK' | 'CONFLICT' | 'NOT_FOUND';

/** Per-row outcome — the UI summarizes okCount and offers to reload the CONFLICT rows. */
export interface BulkResult {
  results: { id: string; status: BulkRowStatus }[];
  okCount: number;
  conflictCount: number;
  notFoundCount: number;
}

const MAX_BULK_ITEMS = 500;

/**
 * The request body for a bulk mutation on a resource with NO version column (no per-row OCC) — a
 * plain id list, e.g. rate-type-assignments `/bulk-deactivate` (UX-11). Shares `BulkRowStatus` /
 * `BulkResult` for the response (a row this resource never returns CONFLICT for still fits the
 * same per-row-status shape).
 */
export const BulkIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(MAX_BULK_ITEMS),
});
export type BulkIdsInput = z.infer<typeof BulkIdsSchema>;
