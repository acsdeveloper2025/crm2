import { z } from 'zod';
import type { CreateRateInput } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { parseIsoDate, parseNumber } from '../../platform/import/parsers.js';
import { clientService } from '../clients/service.js';
import { productService } from '../products/service.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { locationRepository } from '../locations/repository.js';

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
  rateType: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().datetime().optional(),
});
type RateImportFile = z.infer<typeof RateImportFileSchema>;

const RATE_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code', required: true },
  { id: 'unitCode', header: 'Unit Code', required: true },
  { id: 'pincode', header: 'Pincode' },
  { id: 'area', header: 'Area' },
  { id: 'rateType', header: 'Rate Type' },
  { id: 'amount', header: 'Amount', required: true, parse: parseNumber },
  { id: 'currency', header: 'Currency' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const RATE_IMPORT_SAMPLE: Record<string, string> = {
  clientCode: 'HDFC',
  productCode: 'HOME_LOAN',
  unitCode: 'RESI',
  pincode: '400001',
  area: 'Fort',
  rateType: 'Local',
  amount: '500',
  currency: 'INR',
};

/** Template spec (no `resolve` — the template only needs the columns + sample, never FK lookups). */
export const RATE_TEMPLATE_SPEC: ImportSpec<RateImportFile> = {
  resource: 'rates',
  columns: RATE_IMPORT_COLUMNS,
  schema: RateImportFileSchema,
  sample: RATE_IMPORT_SAMPLE,
};

/**
 * Build the rate ImportSpec for ONE request: preload the client/product/unit code→id maps ONCE
 * (the engine's `resolve` is per-row, so we close over the maps instead of re-querying per row),
 * and resolve the location per row via `locationRepository.findByPincodeArea`. Returns the spec the
 * service feeds to `runImportPreview`/`runImportConfirm`.
 */
export async function buildRateSpec(): Promise<ImportSpec<RateImportFile, CreateRateInput>> {
  const [clients, products, units] = await Promise.all([
    clientService.options(),
    productService.options(),
    verificationUnitService.options(),
  ]);
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));
  const productMap = new Map(products.map((p) => [p.code, p.id]));
  const unitMap = new Map(units.map((u) => [u.code, u.id]));

  const resolve = async (input: RateImportFile): Promise<ResolveResult<CreateRateInput>> => {
    const errors: { column: string; message: string }[] = [];

    const clientId = clientMap.get(input.clientCode);
    if (clientId === undefined)
      errors.push({ column: 'Client Code', message: `unknown client code ${input.clientCode}` });
    const productId = productMap.get(input.productCode);
    if (productId === undefined)
      errors.push({ column: 'Product Code', message: `unknown product code ${input.productCode}` });
    const verificationUnitId = unitMap.get(input.unitCode);
    if (verificationUnitId === undefined)
      errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });

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
        productId: productId!,
        verificationUnitId: verificationUnitId!,
        ...(locationId !== undefined ? { locationId } : {}),
        ...(input.rateType ? { rateType: input.rateType } : {}),
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
    resolve,
  };
}
