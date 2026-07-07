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
  };
}

export const RATE_TYPE_IMPORT_SPEC = buildSpec(CreateRateTypeSchema);
