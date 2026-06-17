import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { ZodType } from 'zod';
import type {
  ImportConfirmResult,
  ImportMode,
  ImportPreviewResult,
  ImportRowError,
  JobView,
} from '@crm2/sdk';
import { logger } from '@crm2/logger';
import { loadEnv } from '@crm2/config';
import { AppError } from '../errors.js';
import { HTTP_STATUS } from '../http.js';
import { enqueue, type JobProcessor } from '../jobs/index.js';
import { getStorage } from '../storage/index.js';
import {
  buildImportTemplate,
  countImportRows,
  parseImportFile,
  type ImportColumn,
  type ParsedRow,
} from './format.js';
import { importLogRepository } from './importLog.repository.js';

export { type ImportColumn } from './format.js';

const MODES: ImportMode[] = ['preview', 'confirm'];
const SAMPLE_LIMIT = 20;

/** A per-row async resolution result: the create input, or the per-row errors (e.g. FK code not found). */
export type ResolveResult<TInput> =
  | { ok: true; value: TInput }
  | { ok: false; errors: { column: string; message: string }[] };

/**
 * What a domain plugs into the engine (IMPORT_EXPORT_STANDARD §8): the file column manifest, the zod
 * schema that validates the FILE shape (`TFile`), an optional in-file uniqueness key, a sample row for
 * the template, and — for FK-bearing domains — an optional async `resolve` that turns the validated
 * file row into the create input `TInput` (e.g. client/product CODE → id), reporting per-row errors.
 * `resolve` runs in BOTH preview and confirm, so reference errors surface before the user confirms.
 * The processor (the idempotent writer) is passed to `runImportConfirm`. For FK-free domains
 * `TInput = TFile` and `resolve` is omitted.
 */
export interface ImportSpec<TFile, TInput = TFile> {
  resource: string;
  columns: ImportColumn[];
  schema: ZodType<TFile>;
  /** a column id whose value must be unique within the file; duplicates become row errors. */
  uniqueKey?: string;
  /** one sample data row for the downloadable template (column id → display value). */
  sample?: Record<string, string | number>;
  /** optional async per-row resolution (FK code→id etc.); runs in preview AND confirm. */
  resolve?: (input: TFile, rowNumber: number) => Promise<ResolveResult<TInput>>;
}

/** Below this an import processes synchronously; at/above it runs as a background IMPORT job. */
export function importThreshold(): number {
  return loadEnv().IMPORT_JOB_THRESHOLD;
}

/** Hard ceiling on a single import file's rows (even as a job); above it the file is rejected. */
export function importMaxRows(): number {
  return loadEnv().IMPORT_JOB_MAX_ROWS;
}

/** Validate `?mode=preview|confirm` (no default — the caller must be explicit). */
export function resolveImportMode(reqQuery: Record<string, unknown>): ImportMode {
  const raw = reqQuery['mode'];
  if (!MODES.includes(raw as ImportMode))
    throw AppError.badRequest('BAD_IMPORT_MODE', { mode: raw, allowed: MODES });
  return raw as ImportMode;
}

/**
 * Guard a parse: reject a file above `max` rows. Default `max` is the sync threshold — so modules that
 * have NOT adopted the background tier keep their honest "split the file" 413 at ≥10k. The async-wired
 * path passes `importMaxRows()` (the hard ceiling) since it runs ≥threshold files as a job instead.
 */
export function assertImportable(rowCount: number, max: number = importThreshold()): void {
  if (rowCount >= max)
    throw new AppError(
      HTTP_STATUS.PAYLOAD_TOO_LARGE,
      'IMPORT_TOO_LARGE',
      'too many rows to import — split the file',
      {
        rowCount,
        max,
      },
    );
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build the downloadable XLSX template for a domain. */
export function buildTemplate<TFile, TInput = TFile>(spec: ImportSpec<TFile, TInput>): Promise<Buffer> {
  return buildImportTemplate(spec.columns, spec.sample);
}

/** Stream a built template as an XLSX download (mirrors export's `writeExport`). */
export function writeTemplate(res: Response, buffer: Buffer, filenameBase: string): void {
  res.setHeader('content-type', XLSX_MIME);
  res.setHeader('content-disposition', `attachment; filename="${filenameBase}-import-template.xlsx"`);
  res.send(buffer);
}

/**
 * Validate every parsed row against the schema + the in-file uniqueness key. Returns the valid,
 * typed inputs (carrying their file row number) and a flat list of per-row errors (zod issues mapped
 * to the file column header, plus duplicate-key errors). No writes.
 */
function validateRows<TFile>(
  rows: ParsedRow[],
  spec: ImportSpec<TFile, unknown>,
): { valid: { rowNumber: number; input: TFile }[]; errors: ImportRowError[] } {
  const headerById = new Map(spec.columns.map((c) => [c.id, c.header]));
  const valid: { rowNumber: number; input: TFile }[] = [];
  const errors: ImportRowError[] = [];
  const seen = new Map<string, number>(); // uniqueKey value → first row number that used it

  for (const row of rows) {
    let rowOk = true;

    // in-file duplicate of the unique key (e.g. two rows with the same code)
    if (spec.uniqueKey) {
      const v = row.data[spec.uniqueKey];
      if (typeof v === 'string') {
        const prev = seen.get(v);
        if (prev !== undefined) {
          errors.push({
            rowNumber: row.rowNumber,
            column: headerById.get(spec.uniqueKey) ?? spec.uniqueKey,
            message: `duplicate of row ${prev} in this file`,
          });
          rowOk = false;
        } else {
          seen.set(v, row.rowNumber);
        }
      }
    }

    const parsed = spec.schema.safeParse(row.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const fieldId = typeof issue.path[0] === 'string' ? issue.path[0] : undefined;
        errors.push({
          rowNumber: row.rowNumber,
          column: (fieldId && headerById.get(fieldId)) ?? fieldId ?? '*',
          message: issue.message,
        });
      }
      rowOk = false;
    }

    if (rowOk && parsed.success) valid.push({ rowNumber: row.rowNumber, input: parsed.data });
  }
  return { valid, errors };
}

/** Map file-shape inputs to header-keyed strings for the confirm preview table (first N only). */
function sampleRows(inputs: unknown[], columns: ImportColumn[]): Record<string, string>[] {
  return inputs.slice(0, SAMPLE_LIMIT).map((input) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const v = (input as Record<string, unknown>)[col.id];
      out[col.header] = v === undefined || v === null ? '' : String(v);
    }
    return out;
  });
}

/**
 * Run the optional async `resolve` over the zod-valid rows (identity when no resolver). Returns the
 * processable rows (file shape, or the resolved create input) plus any per-row resolution errors
 * (e.g. an FK code that doesn't exist). Used by both preview and confirm.
 */
async function resolveValid<TFile, TInput>(
  valid: { rowNumber: number; input: TFile }[],
  spec: ImportSpec<TFile, TInput>,
): Promise<{ processable: { rowNumber: number; value: TInput }[]; errors: ImportRowError[] }> {
  const processable: { rowNumber: number; value: TInput }[] = [];
  const errors: ImportRowError[] = [];
  for (const { rowNumber, input } of valid) {
    if (!spec.resolve) {
      processable.push({ rowNumber, value: input as unknown as TInput });
      continue;
    }
    const r = await spec.resolve(input, rowNumber);
    if (r.ok) processable.push({ rowNumber, value: r.value });
    else for (const e of r.errors) errors.push({ rowNumber, column: e.column, message: e.message });
  }
  return { processable, errors };
}

const byRow = (a: ImportRowError, b: ImportRowError): number => a.rowNumber - b.rowNumber;

/** Preview pass (§5): parse + validate (+ resolve), report what would import. No rows are written. */
export async function runImportPreview<TFile, TInput>(
  buffer: Buffer,
  spec: ImportSpec<TFile, TInput>,
  opts?: { maxRows?: number },
): Promise<ImportPreviewResult> {
  const rows = await parseImportFile(buffer, spec.columns);
  assertImportable(rows.length, opts?.maxRows);
  const { valid, errors } = validateRows<TFile>(rows, spec);
  const { processable, errors: resolveErrors } = await resolveValid(valid, spec);
  const okRows = new Set(processable.map((p) => p.rowNumber));
  const sampleInputs = valid.filter((v) => okRows.has(v.rowNumber)).map((v) => v.input);
  return {
    totalRows: rows.length,
    validRows: processable.length,
    errorRows: rows.length - processable.length,
    errors: [...errors, ...resolveErrors].sort(byRow),
    sample: sampleRows(sampleInputs, spec.columns),
  };
}

/**
 * Confirm pass (§5/§6): parse + validate (+ resolve), then run the domain `process` for each resolved
 * row. A row whose write fails (duplicate key in the DB, etc.) is reported but never blocks the other
 * rows. Writes the permanent import_log audit record (§7). The processor must be idempotent + audited.
 */
export async function runImportConfirm<TFile, TInput>(
  buffer: Buffer,
  spec: ImportSpec<TFile, TInput>,
  process: (input: TInput) => Promise<void>,
  ctx: { userId: string; fileName?: string | undefined },
  opts?: { maxRows?: number },
): Promise<ImportConfirmResult> {
  const started = Date.now();
  const rows = await parseImportFile(buffer, spec.columns);
  assertImportable(rows.length, opts?.maxRows);
  const { valid, errors } = validateRows<TFile>(rows, spec);
  const { processable, errors: resolveErrors } = await resolveValid(valid, spec);
  errors.push(...resolveErrors);

  let successRows = 0;
  for (const { rowNumber, value } of processable) {
    try {
      await process(value);
      successRows += 1;
    } catch (e) {
      errors.push({
        rowNumber,
        column: '*',
        message: e instanceof AppError ? (e.message ?? e.code) : 'failed to import row',
      });
    }
  }

  const durationMs = Date.now() - started;
  // failedRows = every row that did not succeed — validation failures AND per-row write failures;
  // all of them are detailed in `errors`. (totalRows = successRows + failedRows.)
  const failedRows = rows.length - successRows;
  await importLogRepository.record({
    resource: spec.resource,
    fileName: ctx.fileName,
    totalRows: rows.length,
    successRows,
    failedRows,
    durationMs,
    actorId: ctx.userId,
  });
  logger.info('data import', {
    event: 'import',
    resource: spec.resource,
    totalRows: rows.length,
    successRows,
    failedRows,
    durationMs,
    actorId: ctx.userId,
  });
  return { totalRows: rows.length, successRows, failedRows, durationMs, errors: errors.sort(byRow) };
}

// ── Background import tier (ADR-0030 / B-14) ──

/** A resource's confirm bound to its spec+processor; runs sync (<threshold) and in the worker (≥threshold). */
export type ImportRunner = (
  buffer: Buffer,
  ctx: { userId: string; fileName?: string | undefined },
) => Promise<ImportConfirmResult>;

const importRunners = new Map<string, ImportRunner>();

/** Register a resource's import runner (boot wiring) — enables its background-import tier. */
export function registerImportRunner(resource: string, fn: ImportRunner): void {
  importRunners.set(resource, fn);
}

/** The IMPORT job processor (registered at boot): fetch the stored file, run the resource's confirm. */
export const importJobProcessor: JobProcessor = async (ctx) => {
  const p = ctx.payload as { resource: string; storageKey: string; fileName?: string; userId: string };
  const runner = importRunners.get(p.resource);
  if (!runner) throw AppError.badRequest('NO_IMPORT_RUNNER', { resource: p.resource });
  await ctx.progress(15, 'Fetching file');
  const buffer = await getStorage().get(p.storageKey);
  await ctx.progress(40, 'Importing rows');
  const result = await runner(buffer, { userId: p.userId, fileName: p.fileName });
  await ctx.progress(95, 'Finishing');
  await getStorage().remove(p.storageKey); // best-effort cleanup; the import_log is the durable record
  // The job result carries the summary counts (the per-row error file is a later enhancement); the
  // full audit lives in import_log.
  return {
    totalRows: result.totalRows,
    successRows: result.successRows,
    failedRows: result.failedRows,
    durationMs: result.durationMs,
  };
};

/** A confirm that ran synchronously, or an enqueued background job (≥ threshold). */
export type ImportConfirmOutcome =
  | { kind: 'result'; result: ImportConfirmResult }
  | { kind: 'job'; job: JobView };

/**
 * Decide sync vs background for a confirm (the resource must have a registered runner). Below the
 * threshold it runs inline; at/above it the raw file is stored (object storage) and an IMPORT job is
 * enqueued — the worker re-runs the SAME runner. A file above the hard ceiling is rejected.
 */
export async function importConfirmOrEnqueue(
  buffer: Buffer,
  resource: string,
  ctx: { userId: string; fileName?: string | undefined },
): Promise<ImportConfirmOutcome> {
  const runner = importRunners.get(resource);
  if (!runner) throw AppError.badRequest('NO_IMPORT_RUNNER', { resource });
  const count = await countImportRows(buffer);
  assertImportable(count, importMaxRows());
  if (count < importThreshold()) return { kind: 'result', result: await runner(buffer, ctx) };
  const storageKey = `imports/${ctx.userId}/${randomUUID()}.bin`;
  await getStorage().put(storageKey, buffer, 'application/octet-stream');
  const job = await enqueue(
    'IMPORT',
    { resource, storageKey, fileName: ctx.fileName, userId: ctx.userId },
    ctx.userId,
  );
  return { kind: 'job', job };
}
