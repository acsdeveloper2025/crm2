import type { ZodType } from 'zod';
import type { ImportColumn, ImportSpec } from '../../platform/import/index.js';
import { parseIsoDate } from '../../platform/import/parsers.js';

/**
 * The shared import manifest for the simple code/name/effective-from master-data lists
 * (clients, products). A domain reuses this by passing its own Create-schema; the columns + sample
 * are identical. `effectiveFrom` is optional (blank → server default now()) and coerced to ISO so the
 * domain's `z.string().datetime()` schema accepts a date typed into Excel.
 */
export const MASTER_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'code', header: 'Code', required: true },
  { id: 'name', header: 'Name', required: true },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

export const MASTER_IMPORT_SAMPLE: Record<string, string> = {
  code: 'ACME_BANK',
  name: 'Acme Bank Ltd',
  effectiveFrom: '2026-01-01',
};

/** Build the ImportSpec shared by code/name/effectiveFrom domains (no FK resolve → TInput = T). */
export function masterDataImportSpec<T>(resource: string, schema: ZodType<T>): ImportSpec<T> {
  return {
    resource,
    columns: MASTER_IMPORT_COLUMNS,
    schema,
    uniqueKey: 'code',
    sample: MASTER_IMPORT_SAMPLE,
  };
}
