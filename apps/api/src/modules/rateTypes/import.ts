import type { ZodType } from 'zod';
import { CreateRateTypeSchema } from '@crm2/sdk';
import type { ImportColumn, ImportSpec } from '../../platform/import/index.js';
import { parseIsoDate, parseInteger } from '../../platform/import/parsers.js';

/**
 * Rate-type import (UX-5): richer than the shared code/name/effectiveFrom manifest (masterDataImport.ts)
 * — rate types also carry description/category/sortOrder, so this builds its own column set directly off
 * `CreateRateTypeSchema` rather than reusing `masterDataImportSpec`. No FK columns → no `resolve` (TInput
 * = TFile), same as clients/products.
 */
const RATE_TYPE_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'code', header: 'Code', required: true },
  { id: 'name', header: 'Name', required: true },
  { id: 'description', header: 'Description' },
  { id: 'category', header: 'Category' }, // blank → schema default FIELD
  { id: 'sortOrder', header: 'Sort Order', parse: parseInteger },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const RATE_TYPE_IMPORT_SAMPLE: Record<string, string> = {
  code: 'LOCAL6',
  name: 'Local (within 6 km)',
  description: 'Field visit within 6 km of the branch',
  category: 'FIELD',
  sortOrder: '10',
  effectiveFrom: '2026-01-01',
};

// One sample row per category shape (CREATE_PAGE_STANDARD §6): a FIELD tier (dated) and an OFFICE type
// (blank effectiveFrom = server default now(), ADR-0017). Distinct codes so the unmodified template
// imports without self-colliding on the unique `code`.
const RATE_TYPE_IMPORT_SAMPLE_ROWS: Record<string, string>[] = [
  RATE_TYPE_IMPORT_SAMPLE,
  {
    code: 'OGL',
    name: 'Office (green line)',
    description: 'Office-processed verification',
    category: 'OFFICE',
    sortOrder: '20',
    effectiveFrom: '',
  },
];

const RATE_TYPE_TEMPLATE_NOTES: string[] = [
  'HOW TO IMPORT RATE TYPES (Code and Name are required on every row).',
  'Code — the unique UPPER_SNAKE_CASE identifier (start with a letter, then letters/digits/underscore), e.g. LOCAL6. It is the catalog key and is IMMUTABLE once created; a code already in the list is reported per-row and skips only that row.',
  'Name — the display label (required).',
  'Category — FIELD (a field-visit tier billing/commission resolves on) or OFFICE (an office rate type); blank defaults to FIELD.',
  'Sort Order — a whole number controlling list order; blank = 0.',
  'Effective From — ISO date (e.g. 2026-01-01); leave blank for "now".',
  'Rows fail independently: valid rows import even when others error (per-row errors list Row · Column · Error).',
  'CSV works too: same header row, comma-separated, first sheet only.',
];

// Built via a generic function (rather than a hand-typed const) so TS infers T from the schema's own
// output — `CreateRateTypeSchema.category` has a `.default()`, so its Input/Output types diverge and a
// direct `ImportSpec<z.infer<...>>` annotation fails the schema field's structural (Input) check.
function buildSpec<T>(schema: ZodType<T>): ImportSpec<T> {
  return {
    resource: 'rate-types',
    columns: RATE_TYPE_IMPORT_COLUMNS,
    schema,
    uniqueKey: 'code',
    sample: RATE_TYPE_IMPORT_SAMPLE,
    sampleRows: RATE_TYPE_IMPORT_SAMPLE_ROWS,
    templateNotes: RATE_TYPE_TEMPLATE_NOTES,
  };
}

export const RATE_TYPE_IMPORT_SPEC = buildSpec(CreateRateTypeSchema);
