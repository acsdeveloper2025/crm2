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

/** Two example records per resource so each template teaches with realistic codes (a bank for Clients,
 *  a product for Products) rather than a generic placeholder. Two DISTINCT codes so importing the
 *  unmodified template never self-collides on the unique `code`. Unknown resources fall back to the
 *  first (generic) pair. */
const MASTER_IMPORT_EXAMPLES: Record<
  string,
  [{ code: string; name: string }, { code: string; name: string }]
> = {
  clients: [
    { code: 'ACME_BANK', name: 'Acme Bank Ltd' },
    { code: 'GLOBAL_CORP', name: 'Global Corp' },
  ],
  products: [
    { code: 'HOME_LOAN', name: 'Home Loan' },
    { code: 'PERSONAL_LOAN', name: 'Personal Loan' },
  ],
};

/** Sample rows for a resource's template (CREATE_PAGE_STANDARD §6, one row per accepted value shape):
 *  the first example dated, the second with a blank effectiveFrom (= server default now(), ADR-0017). */
export function masterSampleRows(resource: string): Record<string, string>[] {
  const [a, b] = MASTER_IMPORT_EXAMPLES[resource] ?? MASTER_IMPORT_EXAMPLES['clients']!;
  return [
    { ...a, effectiveFrom: '2026-01-01' },
    { ...b, effectiveFrom: '' },
  ];
}

/** The template's Notes sheet. Static — a code/name master's rules (UPPER_SNAKE code, required name,
 *  blank effectiveFrom = now) don't drift like a live catalog, so no async builder is needed (cf.
 *  rates' `buildRateTemplateNotes`). `resource` is the plural lowercase list name (clients/products). */
export function masterTemplateNotes(resource: string): string[] {
  return [
    `HOW TO IMPORT ${resource.toUpperCase()} (Code and Name are required on every row).`,
    'Code — the unique identifier in UPPER_SNAKE_CASE: start with a letter, then letters, digits or underscore (e.g. ACME_BANK). A code already in the list is reported per-row and skips only that row.',
    'Name — the display name (free text, required).',
    'Effective From — ISO date (e.g. 2026-01-01); leave blank for "now".',
    'Rows fail independently: valid rows import even when others error (per-row errors list Row · Column · Error).',
    'CSV works too: same header row, comma-separated, first sheet only.',
  ];
}

/** Build the ImportSpec shared by code/name/effectiveFrom domains (no FK resolve → TInput = T). */
export function masterDataImportSpec<T>(resource: string, schema: ZodType<T>): ImportSpec<T> {
  return {
    resource,
    columns: MASTER_IMPORT_COLUMNS,
    schema,
    uniqueKey: 'code',
    sample: MASTER_IMPORT_SAMPLE,
    sampleRows: masterSampleRows(resource),
    templateNotes: masterTemplateNotes(resource),
  };
}
