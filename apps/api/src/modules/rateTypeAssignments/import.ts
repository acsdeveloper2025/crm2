import { z } from 'zod';
import { type CreateRateTypeAssignmentInput, toUpper } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { clientService } from '../clients/service.js';
import { productService } from '../products/service.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { rateTypeService } from '../rateTypes/service.js';

/**
 * Rate-type-assignment import (ADR-0069): the file carries a client CODE (required) + a rate-type CODE
 * (required) + optional product/unit CODEs (blank = Universal / all). The engine's async `resolve` maps
 * each code→id (blank product/unit → NULL = Universal). This file-shape schema validates the spreadsheet
 * row; the numeric-id create-input is enforced downstream by `rateTypeAssignmentService.create`.
 */
const RateTypeAssignmentImportFileSchema = z.object({
  clientCode: z.string().trim().min(1).transform(toUpper),
  // blank = Universal (all products / all units), resolved to NULL.
  productCode: z.string().optional(),
  unitCode: z.string().optional(),
  rateTypeCode: z.string().trim().min(1).transform(toUpper),
});
type RateTypeAssignmentImportFile = z.infer<typeof RateTypeAssignmentImportFileSchema>;

// Exported additively (ADR-0092 S4): the Client Setup onboarding workbook reuses this manifest as
// one of its 5 sheets — no behavior change to the existing rate-type-assignment import/template.
export const RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code' },
  { id: 'unitCode', header: 'Unit Code' },
  { id: 'rateTypeCode', header: 'Rate Type Code', required: true },
];

export const RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE: Record<string, string> = {
  clientCode: 'HDFC',
  productCode: 'HOME_LOAN',
  unitCode: 'RESI',
  rateTypeCode: 'LOCAL',
};

/** One sample row PER accepted value shape (CREATE_PAGE_STANDARD §6 — a single row teaches only one
 *  form): a fully-specified assignment, a Universal-unit assignment (blank Unit), and a Universal
 *  product+unit assignment (blank Product AND Unit — for RTA a BLANK cell is Universal, ADR-0071). */
export const RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE_ROWS: Record<string, string>[] = [
  RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE,
  { clientCode: 'HDFC', productCode: 'HOME_LOAN', unitCode: '', rateTypeCode: 'OGL' },
  { clientCode: 'HDFC', productCode: '', unitCode: '', rateTypeCode: 'LOCAL' },
];

/** The template's Notes sheet — the valid rate-type codes come from the LIVE catalog (`rate_types` is
 *  admin data; a hardcoded list would drift the moment an admin adds a code). Any active rate type is
 *  assignable (unlike the rate import, this column isn't category-restricted). */
export async function buildRateTypeAssignmentTemplateNotes(): Promise<string[]> {
  const codes = (await rateTypeService.options(true)).map((rt) => rt.code);
  return [
    'HOW TO IMPORT RATE TYPE ASSIGNMENTS (Client Code and Rate Type Code are required on every row)',
    'Client Code / Product Code / Unit Code / Rate Type Code — the CODES from Clients / Products / Verification Units / Rate Types (never display names).',
    'Product Code and Unit Code — leave BLANK for Universal: a blank Product applies to ALL products, a blank Unit to ALL units of the client (ADR-0071).',
    `Rate Type Code — must be one of the active codes: ${codes.join(', ')}.`,
    'One assignment = one rate type made available for a Client × Product × Unit slot. Add several rate types to a slot as several rows (one per rate type).',
    'A row identical to an existing ACTIVE assignment is skipped (re-importing never duplicates); a row matching an inactive one re-activates it.',
    'Rows fail independently: valid rows import even when others error (per-row errors list Row · Column · Error).',
    'CSV works too: same header row, comma-separated, first sheet only.',
  ];
}

/** Template spec (no `resolve` — the template only needs columns + samples, never FK lookups). Notes
 *  are injected at call time by the service (they need a live catalog read). */
export const RATE_TYPE_ASSIGNMENT_TEMPLATE_SPEC: ImportSpec<RateTypeAssignmentImportFile> = {
  resource: 'rate-type-assignments',
  columns: RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
  schema: RateTypeAssignmentImportFileSchema,
  sample: RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE,
  sampleRows: RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE_ROWS,
};

/**
 * Build the import ImportSpec for ONE request: preload the client/product/unit/rate-type code→id maps
 * ONCE (the engine's `resolve` is per-row) and map each row to the numeric-id `CreateRateTypeAssignmentInput`.
 * Product/Unit are OPTIONAL — a blank cell ⇒ Universal (NULL).
 */
export async function buildRateTypeAssignmentSpec(): Promise<
  ImportSpec<RateTypeAssignmentImportFile, CreateRateTypeAssignmentInput>
> {
  const [clients, products, units, rateTypes] = await Promise.all([
    clientService.options(),
    productService.options(),
    verificationUnitService.options(),
    rateTypeService.options(true),
  ]);
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));
  const productMap = new Map(products.map((p) => [p.code, p.id]));
  const unitMap = new Map(units.map((u) => [u.code, u.id]));
  const rateTypeMap = new Map(rateTypes.map((rt) => [rt.code, rt.id]));

  const resolve = async (
    input: RateTypeAssignmentImportFile,
  ): Promise<ResolveResult<CreateRateTypeAssignmentInput>> => {
    const errors: { column: string; message: string }[] = [];

    const clientId = clientMap.get(input.clientCode);
    if (clientId === undefined)
      errors.push({ column: 'Client Code', message: `unknown client code ${input.clientCode}` });

    const rateTypeId = rateTypeMap.get(input.rateTypeCode);
    if (rateTypeId === undefined)
      errors.push({ column: 'Rate Type Code', message: `unknown rate type code ${input.rateTypeCode}` });

    let productId: number | undefined;
    if (input.productCode) {
      productId = productMap.get(toUpper(input.productCode));
      if (productId === undefined)
        errors.push({ column: 'Product Code', message: `unknown product code ${input.productCode}` });
    }

    let verificationUnitId: number | undefined;
    if (input.unitCode) {
      verificationUnitId = unitMap.get(toUpper(input.unitCode));
      if (verificationUnitId === undefined)
        errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        clientId: clientId!,
        rateTypeId: rateTypeId!,
        // Universal-able: blank ⇒ null ⇒ matches any.
        productId: productId ?? null,
        verificationUnitId: verificationUnitId ?? null,
      },
    };
  };

  return {
    resource: 'rate-type-assignments',
    columns: RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
    schema: RateTypeAssignmentImportFileSchema,
    sample: RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE,
    sampleRows: RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE_ROWS,
    resolve,
  };
}
