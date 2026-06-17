/**
 * @crm2/sdk — the ONE export contract for every DataGrid (web + mobile).
 * SoT: docs/IMPORT_EXPORT_STANDARD.md §1/§2 + docs/DATAGRID_STANDARD.md §11. The DataGrid is the
 * sole export surface; a grid sends the SAME list query (search/filters/sort) plus the chosen
 * `format` + `mode` + visible `cols`. The server re-runs the query (without the page LIMIT for
 * `all`) and streams a file. `≥ EXPORT_JOB_THRESHOLD` rows → background job (report-worker), not a
 * synchronous payload.
 */
import { type PageQuery, pageQueryToParams } from './pagination.js';
import type { JobView } from './jobs.js';

/** Primary XLSX · Secondary CSV (PDF optional — not yet built). */
export type ExportFormat = 'xlsx' | 'csv';

/**
 * Which rows to export:
 *  - `current` — exactly the current page (what the user sees).
 *  - `all` — every row matching the active search + filters (re-runs the query, no page LIMIT).
 *  - `selected` — the explicitly ticked rows (`ids`); the server applies them on top of the scoped
 *    list query (so out-of-scope ids can never leak). "Select all matching" uses `all`, not this.
 */
export type ExportMode = 'current' | 'all' | 'selected';

/** An export request = the list query + the chosen format/mode/visible columns. */
export interface ExportRequest extends PageQuery {
  format: ExportFormat;
  mode: ExportMode;
  /** visible DataGrid column ids, in display order; omitted → the server's full manifest. */
  cols?: string[];
  /** the ticked row ids (only for `mode:'selected'`). */
  ids?: string[];
}

/** A downloaded export: the file blob plus the server-suggested filename (Content-Disposition). */
export interface ExportResult {
  blob: Blob;
  filename: string;
}

/**
 * The outcome of an export request (ADR-0030 / B-13): a small set streams a `file` synchronously; an
 * `all` export ≥ EXPORT_JOB_THRESHOLD comes back as a 202 `job` (the FE tracks it + downloads via
 * /jobs/:id/result-url when done). The DataGrid handles both.
 */
export type ExportOutcome = { kind: 'file'; blob: Blob; filename: string } | { kind: 'job'; job: JobView };

/**
 * Serialize an ExportRequest to URL params. For `mode:'current'` the page/limit are kept (the exact
 * page); for `mode:'all'` they are dropped so the server returns all matching rows (capped by the
 * job threshold). Reuses `pageQueryToParams` for search/sort/filters so the export matches the list.
 */
export function exportQueryToParams(r: ExportRequest): URLSearchParams {
  let base: PageQuery = r;
  if (r.mode === 'all' || r.mode === 'selected') {
    // `all`/`selected` ignore the page window — the server returns all matching (capped) or exactly
    // the ticked ids — so drop page/limit.
    const { page: _page, limit: _limit, ...rest } = r;
    base = rest;
  }
  const p = pageQueryToParams(base);
  p.set('format', r.format);
  p.set('mode', r.mode);
  if (r.cols && r.cols.length) p.set('cols', r.cols.join(','));
  if (r.mode === 'selected' && r.ids && r.ids.length) p.set('ids', r.ids.join(','));
  return p;
}
