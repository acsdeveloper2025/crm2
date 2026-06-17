import type { Request, Response } from 'express';
import { loadEnv } from '@crm2/config';
import type { ExportFormat, JobView } from '@crm2/sdk';
import { logger } from '@crm2/logger';
import { AppError } from '../errors.js';
import { HTTP_STATUS } from '../http.js';
import { enqueue, type JobProcessor } from '../jobs/index.js';
import { getStorage } from '../storage/index.js';
import { type ExportColumn, EXPORT_MIME, selectColumns, toCsv, toXlsx } from './format.js';
import { resolveExport, writeExport, type ResolvedExport } from './index.js';

/**
 * Background EXPORT jobs (ADR-0030 / B-13). A synchronous `all` export at/above EXPORT_JOB_THRESHOLD
 * (the 413 ceiling) instead becomes a job: the runner re-runs the SAME scoped query, builds the file,
 * stores it (object storage, ADR-0021), and the owner downloads it via a presigned URL — never
 * streaming an unbounded payload inline. A module opts in by registering an ExportBuild closure (it
 * keeps its own typed columns + the shared buildExportFile), so the engine stays type-agnostic.
 */

const stamp = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '');

/** Build the file bytes from typed rows + the module's column manifest (restricted to visible `cols`). */
export async function buildExportFile<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  cols: string[],
  filenameBase: string,
  format: ExportFormat,
): Promise<{ body: Buffer; filename: string; rowCount: number }> {
  const selected = selectColumns(columns, cols);
  const body =
    format === 'csv'
      ? Buffer.from(toCsv(rows, selected), 'utf8')
      : await toXlsx(rows, selected, filenameBase);
  return { body, filename: `${filenameBase}-${stamp()}.${format}`, rowCount: rows.length };
}

/**
 * A module's async export: fetch up to MAX_EXPORT_ROWS for `query` and build the file. `totalCount`
 * (when provided) is the FULL matching count — if it exceeds `rowCount` the export was capped, which
 * the processor surfaces in the job result + logs (no silent truncation, IMPORT_EXPORT_STANDARD).
 */
export type ExportBuild = (
  query: Record<string, unknown>,
  actorId: string,
  cols: string[],
  format: ExportFormat,
) => Promise<{ body: Buffer; filename: string; rowCount: number; totalCount?: number }>;

const builders = new Map<string, ExportBuild>();

/** Register a resource's async export builder (boot wiring). Last registration wins. */
export function registerExportBuilder(resource: string, fn: ExportBuild): void {
  builders.set(resource, fn);
}
export function hasExportBuilder(resource: string): boolean {
  return builders.has(resource);
}
/** The per-job row cap a module's builder must honor when fetching the `all` set (EXPORT_JOB_MAX_ROWS). */
export const exportJobRowCap = (): number => loadEnv().EXPORT_JOB_MAX_ROWS;

interface ExportJobPayload {
  resource: string;
  query: Record<string, unknown>;
  format: ExportFormat;
  cols: string[];
  actorId: string;
}

/** The EXPORT job processor (registered at boot). Builds + stores the file, returns its pointer. */
export const exportJobProcessor: JobProcessor = async (ctx) => {
  const p = ctx.payload as ExportJobPayload;
  const build = builders.get(p.resource);
  if (!build) throw AppError.badRequest('NO_EXPORT_BUILDER', { resource: p.resource });
  await ctx.progress(20, 'Building export');
  const { body, filename, rowCount, totalCount } = await build(p.query, p.actorId, p.cols, p.format);
  await ctx.progress(80, 'Uploading');
  const storageKey = `exports/${p.actorId}/${ctx.jobId}.${p.format}`;
  await getStorage().put(storageKey, body, EXPORT_MIME[p.format]);
  // Surface a capped export rather than silently dropping rows (IMPORT_EXPORT_STANDARD: log what was
  // dropped). The unbounded streaming-builder is the proper fix (carried for the report-worker phase).
  const matched = totalCount ?? rowCount;
  const capped = matched > rowCount;
  if (capped)
    logger.warn('export capped at row limit', {
      jobId: ctx.jobId,
      resource: p.resource,
      exported: rowCount,
      matched,
      cap: exportJobRowCap(),
    });
  return { storageKey, filename, rowCount, totalCount: matched, capped, format: p.format };
};

/**
 * Controller wrapper: stream the export synchronously, but if the module's `all` path hits the 413
 * ceiling AND an async builder is registered for the resource, enqueue an EXPORT job and answer 202
 * with the job row (the FE then polls /jobs/:id and downloads via /jobs/:id/result-url). Resources
 * with no registered builder keep the honest 413 (incremental rollout). `run` is the module's existing
 * exportData(query, ex) — zero churn to it.
 */
export async function exportOrEnqueue<T>(
  req: Request,
  res: Response,
  opts: {
    resource: string;
    filenameBase: string;
    run: (ex: ResolvedExport) => Promise<{ rows: T[]; columns: ExportColumn<T>[] }>;
  },
): Promise<void> {
  const ex = resolveExport(req.query as Record<string, unknown>);
  const actorId = req.auth?.userId ?? 'unknown';
  try {
    const { rows, columns } = await opts.run(ex);
    await writeExport(res, {
      rows,
      columns,
      ex,
      filenameBase: opts.filenameBase,
      resource: opts.resource,
      actorId,
    });
  } catch (e) {
    if (e instanceof AppError && e.code === 'EXPORT_TOO_LARGE' && builders.has(opts.resource)) {
      const job = await enqueueExport(opts.resource, req.query as Record<string, unknown>, ex, actorId);
      res.status(HTTP_STATUS.ACCEPTED).json(job);
      return;
    }
    throw e;
  }
}

/** Enqueue an EXPORT job for a resource's current view/filters (used by exportOrEnqueue + tests). */
export function enqueueExport(
  resource: string,
  query: Record<string, unknown>,
  ex: ResolvedExport,
  actorId: string,
): Promise<JobView> {
  const payload: ExportJobPayload = { resource, query, format: ex.format, cols: ex.cols, actorId };
  return enqueue('EXPORT', payload, actorId);
}
