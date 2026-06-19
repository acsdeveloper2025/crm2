import { z } from 'zod';
import type { CreateCommissionRateInput } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { parseInteger, parseIsoDate, parseNumber } from '../../platform/import/parsers.js';
import { clientService } from '../clients/service.js';
import { productService } from '../products/service.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { locationRepository } from '../locations/repository.js';
import { userService } from '../users/service.js';

/**
 * Commission-rate import (ADR-0036 + ADR-0046): the file carries a USERNAME + optional classification
 * label + optional client CODE (blank = any client) + amount, plus the optional ADR-0046 dimensions —
 * a Location (Pincode + Area), Product Code, Unit Code, and TAT Band (each blank = "applies
 * generally"). The engine's async `resolve` maps username→userId, codes→ids, and pincode+area→
 * locationId. This file-shape schema validates the SPREADSHEET row; the numeric-id create-input is
 * enforced downstream by `commissionRateService.create` (incl. the no-overlap DB guard).
 */
const CommissionRateImportFileSchema = z.object({
  username: z.string().min(1),
  rateType: z.string().optional(),
  clientCode: z.string().optional(),
  pincode: z.string().optional(),
  area: z.string().optional(),
  productCode: z.string().optional(),
  unitCode: z.string().optional(),
  tatBand: z.number().int().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().datetime().optional(),
});
type CommissionRateImportFile = z.infer<typeof CommissionRateImportFileSchema>;

const COMMISSION_RATE_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'username', header: 'Username', required: true },
  // 'Rate Type' header retained (existing import files) — now an OPTIONAL classification label (ADR-0046).
  { id: 'rateType', header: 'Rate Type' },
  { id: 'clientCode', header: 'Client Code' },
  { id: 'pincode', header: 'Location Pincode' },
  { id: 'area', header: 'Area' },
  { id: 'productCode', header: 'Product Code' },
  { id: 'unitCode', header: 'Unit Code' },
  { id: 'tatBand', header: 'TAT Band', parse: parseInteger },
  { id: 'amount', header: 'Amount', required: true, parse: parseNumber },
  { id: 'currency', header: 'Currency' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const COMMISSION_RATE_IMPORT_SAMPLE: Record<string, string> = {
  username: 'ravi_field',
  rateType: 'LOCAL',
  clientCode: 'HDFC',
  pincode: '400001',
  area: 'Fort',
  productCode: 'HOME_LOAN',
  unitCode: 'RESI',
  tatBand: '24',
  amount: '50',
  currency: 'INR',
};

/** Template spec (no `resolve` — the template only needs columns + sample, never FK lookups). */
export const COMMISSION_RATE_TEMPLATE_SPEC: ImportSpec<CommissionRateImportFile> = {
  resource: 'commission-rates',
  columns: COMMISSION_RATE_IMPORT_COLUMNS,
  schema: CommissionRateImportFileSchema,
  sample: COMMISSION_RATE_IMPORT_SAMPLE,
};

/**
 * Build the commission-rate ImportSpec for ONE request: preload the username/client/product/unit
 * code→id maps ONCE (the engine's `resolve` is per-row, so close over the maps instead of re-querying)
 * and resolve the location per row via `locationRepository.findByPincodeArea`. Map each row to the
 * numeric-id `CreateCommissionRateInput`. Every dimension column is OPTIONAL — a blank cell ⇒ "applies
 * generally" (NULL) for that dimension.
 */
export async function buildCommissionRateSpec(): Promise<
  ImportSpec<CommissionRateImportFile, CreateCommissionRateInput>
> {
  const [users, clients, products, units] = await Promise.all([
    userService.options(),
    clientService.options(),
    productService.options(),
    verificationUnitService.options(),
  ]);
  const userMap = new Map(users.map((u) => [u.username, u.id]));
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));
  const productMap = new Map(products.map((p) => [p.code, p.id]));
  const unitMap = new Map(units.map((u) => [u.code, u.id]));

  const resolve = async (
    input: CommissionRateImportFile,
  ): Promise<ResolveResult<CreateCommissionRateInput>> => {
    const errors: { column: string; message: string }[] = [];

    const userId = userMap.get(input.username);
    if (userId === undefined)
      errors.push({ column: 'Username', message: `unknown username ${input.username}` });

    let clientId: number | undefined;
    if (input.clientCode) {
      clientId = clientMap.get(input.clientCode);
      if (clientId === undefined)
        errors.push({ column: 'Client Code', message: `unknown client code ${input.clientCode}` });
    }

    let productId: number | undefined;
    if (input.productCode) {
      productId = productMap.get(input.productCode);
      if (productId === undefined)
        errors.push({ column: 'Product Code', message: `unknown product code ${input.productCode}` });
    }

    let verificationUnitId: number | undefined;
    if (input.unitCode) {
      verificationUnitId = unitMap.get(input.unitCode);
      if (verificationUnitId === undefined)
        errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });
    }

    let locationId: number | undefined;
    const hasPincode = !!input.pincode;
    const hasArea = !!input.area;
    if (hasPincode && hasArea) {
      const loc = await locationRepository.findByPincodeArea(input.pincode!, input.area!);
      if (!loc)
        errors.push({
          column: 'Location Pincode',
          message: `no usable location for pincode ${input.pincode} area ${input.area}`,
        });
      else locationId = loc.id;
    } else if (hasPincode !== hasArea) {
      errors.push({
        column: hasPincode ? 'Area' : 'Location Pincode',
        message: 'provide both Location Pincode and Area, or neither',
      });
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        userId: userId!,
        ...(input.rateType ? { rateType: input.rateType } : {}),
        ...(clientId !== undefined ? { clientId } : {}),
        ...(locationId !== undefined ? { locationId } : {}),
        ...(productId !== undefined ? { productId } : {}),
        ...(verificationUnitId !== undefined ? { verificationUnitId } : {}),
        ...(input.tatBand !== undefined ? { tatBand: input.tatBand } : {}),
        amount: input.amount,
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    };
  };

  return {
    resource: 'commission-rates',
    columns: COMMISSION_RATE_IMPORT_COLUMNS,
    schema: CommissionRateImportFileSchema,
    sample: COMMISSION_RATE_IMPORT_SAMPLE,
    resolve,
  };
}
