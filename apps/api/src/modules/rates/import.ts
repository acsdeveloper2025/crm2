import { z } from 'zod';
import type { CreateRateInput } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { parseIsoDate, parseNumber } from '../../platform/import/parsers.js';
import { clientService } from '../clients/service.js';
import { productService } from '../products/service.js';
import { rateTypeService } from '../rateTypes/service.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { locationRepository } from '../locations/repository.js';

/** ADR-0071: the EXPLICIT Universal literal for Product/Unit cells. A blank cell stays an error —
 *  a money table must never default to Universal on an accidentally-empty cell (fail-loud). */
const UNIVERSAL_LITERAL = 'UNIVERSAL';
const isUniversal = (code: string): boolean => code.trim().toUpperCase() === UNIVERSAL_LITERAL;

/**
 * Rates is the ONLY FK-resolving import (B-14): the file carries human CODES (client/product/unit)
 * + a pincode+area geography, and the engine's async `resolve` maps them to the numeric FK ids that
 * `CreateRateSchema` needs. This file-shape schema validates the SPREADSHEET row (codes + amount);
 * the create-input schema (numeric ids) is enforced downstream by `rateService.create`.
 */
const RateImportFileSchema = z.object({
  clientCode: z.string().min(1),
  productCode: z.string().min(1),
  unitCode: z.string().min(1),
  pincode: z.string().optional(),
  area: z.string().optional(),
  clientRateType: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().datetime().optional(),
});
type RateImportFile = z.infer<typeof RateImportFileSchema>;

// Exported additively (ADR-0092 S4): the Client Setup onboarding workbook reuses this manifest as
// one of its 5 sheets — no behavior change to the existing Rates import/template.
export const RATE_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code', required: true },
  { id: 'unitCode', header: 'Unit Code', required: true },
  { id: 'pincode', header: 'Pincode' },
  { id: 'area', header: 'Area' },
  { id: 'clientRateType', header: 'Rate Type' },
  { id: 'amount', header: 'Amount', required: true, parse: parseNumber },
  { id: 'currency', header: 'Currency' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

export const RATE_IMPORT_SAMPLE: Record<string, string> = {
  clientCode: 'HDFC',
  productCode: 'HOME_LOAN',
  unitCode: 'RESI',
  pincode: '400001',
  area: 'Fort',
  clientRateType: 'Local',
  amount: '500',
  currency: 'INR',
};

/** One sample row PER accepted value shape (CREATE_PAGE_STANDARD §6 — a single row teaches only one
 *  form): a located field rate, a flat office/KYC rate (no geography, no rate type), and a Universal
 *  product+unit rate (the explicit UNIVERSAL literal, ADR-0071). */
export const RATE_IMPORT_SAMPLE_ROWS: Record<string, string | number>[] = [
  RATE_IMPORT_SAMPLE,
  {
    clientCode: 'HDFC',
    productCode: 'HOME_LOAN',
    unitCode: 'KYC',
    pincode: '',
    area: '',
    clientRateType: '',
    amount: '300',
    currency: 'INR',
  },
  {
    clientCode: 'HDFC',
    productCode: UNIVERSAL_LITERAL,
    unitCode: UNIVERSAL_LITERAL,
    pincode: '400001',
    area: 'Fort',
    clientRateType: 'OGL',
    amount: '650',
    currency: 'INR',
  },
];

/** The template's Notes sheet — the valid rate-type codes come from the LIVE catalog (`rate_types`
 *  is admin data; a hardcoded list would drift the moment an admin adds a code). */
export async function buildRateTemplateNotes(): Promise<string[]> {
  // Only FIELD-category codes belong in the Rate Type column — office rates leave it blank, so
  // listing an OFFICE-category code here would contradict the "leave blank for office" line below.
  const fieldCodes = (await rateTypeService.options(true))
    .filter((rt) => rt.category !== 'OFFICE')
    .map((rt) => rt.code);
  return [
    'HOW TO IMPORT RATES (Client Code, Product Code, Unit Code and Amount are required on every row)',
    'Client Code / Product Code / Unit Code — the CODES from Clients / Products / Verification Units (never display names).',
    `Product Code and Unit Code also accept the literal ${UNIVERSAL_LITERAL} — the rate then applies to ALL products / ALL units of the client (ADR-0071). A blank cell is an error, never Universal.`,
    'Pincode + Area — provide BOTH (a located field rate) or NEITHER (a flat office/KYC rate). One of the two alone is an error.',
    `Rate Type — a located field rate’s tier; must be one of the active field codes: ${fieldCodes.join(', ')}. Leave blank for office/KYC rates.`,
    'One location holds ONE rate type per client + product + unit — a row whose location already carries a different type is rejected (the row error names the rule).',
    'A row identical to an existing ACTIVE rate over an overlapping period is rejected as a duplicate — the existing rate keeps its amount (change amounts with Revise, not re-import).',
    'Currency — 3-letter code; blank = INR. Effective From — ISO date (e.g. 2026-07-11); blank = now.',
    'Rows fail independently: valid rows import even when others error (per-row errors list Row · Column · Error).',
    'CSV works too: same header row, comma-separated, first sheet only.',
  ];
}

/** Template spec (no `resolve` — the template only needs the columns + samples, never FK lookups). */
export const RATE_TEMPLATE_SPEC: ImportSpec<RateImportFile> = {
  resource: 'rates',
  columns: RATE_IMPORT_COLUMNS,
  schema: RateImportFileSchema,
  sample: RATE_IMPORT_SAMPLE,
  sampleRows: RATE_IMPORT_SAMPLE_ROWS,
};

/**
 * Build the rate ImportSpec for ONE request: preload the client/product/unit code→id maps ONCE
 * (the engine's `resolve` is per-row, so we close over the maps instead of re-querying per row),
 * and resolve the location per row via `locationRepository.findByPincodeArea`. Returns the spec the
 * service feeds to `runImportPreview`/`runImportConfirm`.
 */
export async function buildRateSpec(): Promise<ImportSpec<RateImportFile, CreateRateInput>> {
  const [clients, products, units, rateTypes] = await Promise.all([
    clientService.options(),
    productService.options(),
    verificationUnitService.options(),
    rateTypeService.options(true),
  ]);
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));
  const productMap = new Map(products.map((p) => [p.code, p.id]));
  const unitMap = new Map(units.map((u) => [u.code, u.id]));
  const rateTypeCodes = new Set(rateTypes.map((rt) => rt.code));

  const resolve = async (input: RateImportFile): Promise<ResolveResult<CreateRateInput>> => {
    const errors: { column: string; message: string }[] = [];

    const clientId = clientMap.get(input.clientCode);
    if (clientId === undefined)
      errors.push({ column: 'Client Code', message: `unknown client code ${input.clientCode}` });
    // ADR-0071: the explicit UNIVERSAL literal → null (all products / all units of the client).
    const productId = isUniversal(input.productCode) ? null : productMap.get(input.productCode);
    if (productId === undefined)
      errors.push({ column: 'Product Code', message: `unknown product code ${input.productCode}` });
    const verificationUnitId = isUniversal(input.unitCode) ? null : unitMap.get(input.unitCode);
    if (verificationUnitId === undefined)
      errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });
    // A typo'd rate type must be a row error — the DB lookup would otherwise silently NULL the
    // rate_type_id and import a typeless rate (fail-loud over silent substitution).
    if (input.clientRateType && !rateTypeCodes.has(input.clientRateType.trim().toUpperCase()))
      errors.push({
        column: 'Rate Type',
        message: `unknown rate type ${input.clientRateType} — use an active catalog code`,
      });

    let locationId: number | undefined;
    const hasPincode = !!input.pincode;
    const hasArea = !!input.area;
    if (hasPincode && hasArea) {
      const loc = await locationRepository.findByPincodeArea(input.pincode!, input.area!);
      if (!loc)
        errors.push({
          column: 'Pincode',
          message: `no usable location for pincode ${input.pincode} area ${input.area}`,
        });
      else locationId = loc.id;
    } else if (hasPincode !== hasArea) {
      errors.push({
        column: hasPincode ? 'Area' : 'Pincode',
        message: 'provide both Pincode and Area, or neither',
      });
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        clientId: clientId!,
        productId: productId ?? null, // null = the explicit Universal literal (ADR-0071)
        verificationUnitId: verificationUnitId ?? null,
        ...(locationId !== undefined ? { locationId } : {}),
        ...(input.clientRateType ? { clientRateType: input.clientRateType } : {}),
        amount: input.amount,
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    };
  };

  return {
    resource: 'rates',
    columns: RATE_IMPORT_COLUMNS,
    schema: RateImportFileSchema,
    sample: RATE_IMPORT_SAMPLE,
    sampleRows: RATE_IMPORT_SAMPLE_ROWS,
    resolve,
  };
}
