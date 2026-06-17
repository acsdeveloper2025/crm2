import { z } from 'zod';
import type { CreateCommissionRateInput } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { parseIsoDate, parseNumber } from '../../platform/import/parsers.js';
import { clientService } from '../clients/service.js';
import { userService } from '../users/service.js';

/**
 * Commission-rate import (ADR-0036): the file carries a USERNAME + rate type + optional client CODE
 * (blank = universal) + amount; the engine's async `resolve` maps username→userId and clientCode→
 * clientId. This file-shape schema validates the SPREADSHEET row; the numeric-id create-input is
 * enforced downstream by `commissionRateService.create` (incl. the no-overlap DB guard).
 */
const CommissionRateImportFileSchema = z.object({
  username: z.string().min(1),
  rateType: z.string().min(1),
  clientCode: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  effectiveFrom: z.string().datetime().optional(),
});
type CommissionRateImportFile = z.infer<typeof CommissionRateImportFileSchema>;

const COMMISSION_RATE_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'username', header: 'Username', required: true },
  { id: 'rateType', header: 'Rate Type', required: true },
  { id: 'clientCode', header: 'Client Code' },
  { id: 'amount', header: 'Amount', required: true, parse: parseNumber },
  { id: 'currency', header: 'Currency' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const COMMISSION_RATE_IMPORT_SAMPLE: Record<string, string> = {
  username: 'ravi_field',
  rateType: 'LOCAL',
  clientCode: 'HDFC',
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
 * Build the commission-rate ImportSpec for ONE request: preload the username→id and clientCode→id
 * maps ONCE (the engine's `resolve` is per-row, so close over the maps instead of re-querying), and
 * map each row to the numeric-id `CreateCommissionRateInput`. A blank Client Code → universal (null).
 */
export async function buildCommissionRateSpec(): Promise<
  ImportSpec<CommissionRateImportFile, CreateCommissionRateInput>
> {
  const [users, clients] = await Promise.all([userService.options(), clientService.options()]);
  const userMap = new Map(users.map((u) => [u.username, u.id]));
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));

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

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        userId: userId!,
        rateType: input.rateType,
        ...(clientId !== undefined ? { clientId } : {}),
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
