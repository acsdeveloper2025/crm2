import type { Response } from 'express';
import type { ExportFormat, ExportMode } from '@crm2/sdk';
import { logger } from '@crm2/logger';
import { loadEnv } from '@crm2/config';
import { AppError } from '../errors.js';
import { HTTP_STATUS } from '../http.js';
import { type ExportColumn, EXPORT_MIME, selectColumns, toCsv, toXlsx } from './format.js';

export { type ExportColumn } from './format.js';

const FORMATS: ExportFormat[] = ['xlsx', 'csv'];
const MODES: ExportMode[] = ['current', 'all', 'selected'];

/** Parsed + validated export request params (`?format=&mode=&cols=&ids=`). */
export interface ResolvedExport {
  format: ExportFormat;
  mode: ExportMode;
  /** visible DataGrid column ids, in display order; empty → the module's full manifest. */
  cols: string[];
  /** ticked row ids for `mode:'selected'` (raw strings; the module maps to its id type). */
  ids: string[];
}

/** Validate the export query (defaults xlsx/current). Unknown format/mode → 400 (never silent). */
export function resolveExport(query: Record<string, unknown>): ResolvedExport {
  const rawFormat = query['format'];
  const format = rawFormat === undefined ? 'xlsx' : rawFormat;
  if (!FORMATS.includes(format as ExportFormat))
    throw AppError.badRequest('BAD_EXPORT_FORMAT', { format, allowed: FORMATS });
  const rawMode = query['mode'];
  const mode = rawMode === undefined ? 'current' : rawMode;
  if (!MODES.includes(mode as ExportMode))
    throw AppError.badRequest('BAD_EXPORT_MODE', { mode, allowed: MODES });
  const rawCols = query['cols'];
  const cols = typeof rawCols === 'string' && rawCols.trim() ? rawCols.split(',').filter(Boolean) : [];
  const rawIds = query['ids'];
  const ids = typeof rawIds === 'string' && rawIds.trim() ? rawIds.split(',').filter(Boolean) : [];
  return { format: format as ExportFormat, mode: mode as ExportMode, cols, ids };
}

/** The synchronous-export ceiling. At/above it, an `all` export must become a background job (≥10k). */
export function exportThreshold(): number {
  return loadEnv().EXPORT_JOB_THRESHOLD;
}

/**
 * Guard the synchronous `all` path: a result set at/above the job threshold cannot stream inline
 * (IMPORT_EXPORT_STANDARD §2) — the caller must enqueue a background job (report-worker, deferred).
 * Throws 413 EXPORT_TOO_LARGE carrying the count + threshold so the UI can message it.
 */
export function assertExportable(totalCount: number): void {
  const threshold = exportThreshold();
  if (totalCount >= threshold)
    throw new AppError(
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      'EXPORT_TOO_LARGE',
      'too many rows for a synchronous export — use a background export job',
      { totalCount, threshold },
    );
}

const stamp = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Build the file from the rows + the module's column manifest (restricted to the visible `cols`) and
 * stream it as a download. Writes an export-audit log line (@crm2/logger). The DataGrid is the only
 * caller path; modules supply `rows` + `columns`, never their own file format.
 */
export async function writeExport<T>(
  res: Response,
  opts: {
    rows: T[];
    columns: ExportColumn<T>[];
    ex: ResolvedExport;
    /** download filename base, e.g. `clients` → `clients-20260607.csv`. */
    filenameBase: string;
    /** full filename override (extension appended) — e.g. a date-time + export-number name
     *  (`kyc-tasks-20260702-1213-exp12`). Default stays `<filenameBase>-<yyyymmdd>`. */
    filename?: string;
    /** resource + actor for the export-audit log line. */
    resource: string;
    actorId: string;
  },
): Promise<void> {
  const columns = selectColumns(opts.columns, opts.ex.cols);
  const filename = `${opts.filename ?? `${opts.filenameBase}-${stamp()}`}.${opts.ex.format}`;
  const body =
    opts.ex.format === 'csv'
      ? Buffer.from(toCsv(opts.rows, columns), 'utf8')
      : await toXlsx(opts.rows, columns, opts.filenameBase);

  logger.info('data export', {
    event: 'export',
    resource: opts.resource,
    format: opts.ex.format,
    mode: opts.ex.mode,
    rowCount: opts.rows.length,
    actorId: opts.actorId,
  });

  res.setHeader('content-type', EXPORT_MIME[opts.ex.format]);
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.send(body);
}
