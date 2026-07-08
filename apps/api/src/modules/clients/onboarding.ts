import type { ImportColumn } from '../../platform/import/index.js';
import { MASTER_IMPORT_COLUMNS, MASTER_IMPORT_SAMPLE } from '../shared/masterDataImport.js';
import { CPV_IMPORT_COLUMNS, CPV_IMPORT_SAMPLE } from '../cpv/import.js';
import {
  RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
  RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE,
} from '../rateTypeAssignments/import.js';
import { RATE_IMPORT_COLUMNS, RATE_IMPORT_SAMPLE } from '../rates/import.js';
import { COMMISSION_RATE_IMPORT_COLUMNS, COMMISSION_RATE_IMPORT_SAMPLE } from '../commissionRates/import.js';

/**
 * The Client Setup onboarding workbook (ADR-0092 S4): one XLSX bundling the 5 domain templates a new
 * client needs filling in, in build order (`ClientSetupPage`'s own step order — CPV before
 * RateTypeAssignments/Rates/CommissionRates). Every sheet has one sample row; every `Client Code`
 * sample cell is pre-filled with the real client's code (spec §4.5) — Products has none, it's a
 * global list, not client-scoped. The CPV sample's `unitCode` is `UNIVERSAL` (not a real unit code)
 * to document the CPV-Universal delta (ADR-0074): most clients need one CPV row per product with the
 * Universal unit, not one per physical verification unit.
 *
 * Locations (pincode+area) and users (commission-rate assignee) referenced by the Rates/CPV/
 * CommissionRates samples are assumed to pre-exist — this workbook only feeds the S5 import runner,
 * which resolves them by code/username; it never creates them.
 */
export const ONBOARDING_SHEET_NAMES = [
  'Products',
  'CPV',
  'RateTypeAssignments',
  'Rates',
  'CommissionRates',
] as const;

export function onboardingTemplateSheets(
  clientCode: string,
): { name: string; columns: ImportColumn[]; sample?: Record<string, string | number> }[] {
  return [
    { name: 'Products', columns: MASTER_IMPORT_COLUMNS, sample: MASTER_IMPORT_SAMPLE },
    {
      name: 'CPV',
      columns: CPV_IMPORT_COLUMNS,
      sample: { ...CPV_IMPORT_SAMPLE, clientCode, unitCode: 'UNIVERSAL' },
    },
    {
      name: 'RateTypeAssignments',
      columns: RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
      sample: { ...RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE, clientCode },
    },
    { name: 'Rates', columns: RATE_IMPORT_COLUMNS, sample: { ...RATE_IMPORT_SAMPLE, clientCode } },
    {
      name: 'CommissionRates',
      columns: COMMISSION_RATE_IMPORT_COLUMNS,
      sample: { ...COMMISSION_RATE_IMPORT_SAMPLE, clientCode },
    },
  ];
}
