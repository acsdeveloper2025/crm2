/**
 * @crm2/sdk — the bulk-mutation contract (CONCURRENCY_AND_EDITING_STANDARD §1/§7; DATAGRID_STANDARD
 * §15 bulk actions). A bulk endpoint takes `{ items: [{ id, version }] }` and returns a per-row
 * result — every row is version-guarded (OCC), so a row changed since selection comes back as
 * CONFLICT, never a silent overwrite.
 */

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
