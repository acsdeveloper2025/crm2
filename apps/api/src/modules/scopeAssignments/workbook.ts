import { z } from 'zod';
import type { OnboardingConfirmResult, OnboardingPreviewResult } from '@crm2/sdk';
import {
  buildWorkbookTemplate,
  runImportConfirm,
  runImportPreview,
  type ImportSpec,
  type ResolveResult,
} from '../../platform/import/index.js';
import { AppError } from '../../platform/errors.js';
import { dimensionDef } from '../../platform/scope/dimensions.js';
import { scopeAssignmentRepository as repo } from './repository.js';
import { userKycUnitsRepository as kycRepo } from '../userKycUnits/repository.js';

/**
 * Role-shaped scope workbook (owner 2026-07-11): the long Username/Dimension/Entity layout was hard
 * to fill, so the template/import is now ONE workbook with a sheet PER ROLE SHAPE — each sheet has
 * real columns instead of a generic Entity cell:
 *   Field Agents  — Username | Pincode | Area        (blank Area = ALL areas of the pincode)
 *   Backend Users — Username | Client Code | Product Code (each filled cell = one assignment)
 *   KYC Users     — Username | Unit Code             (OFFICE/KYC assignment eligibility, ADR-0073)
 * Row-level rules are unchanged: assignability is still the target ROLE's live dimension wiring; a
 * mismatched row is a per-row error and the rest of the file imports. The legacy single-sheet
 * format stays served by the original /users/scope/import routes (additive /api/v2).
 */
export const SCOPE_SHEET_FIELD = 'Field Agents';
export const SCOPE_SHEET_BACKEND = 'Backend Users';
export const SCOPE_SHEET_KYC = 'KYC Users';

const MAX_USERNAME_LEN = 50;
const username = z.string().trim().min(1).max(MAX_USERNAME_LEN);
const cell = z.string().trim().min(1).max(200);

const FieldRowSchema = z.object({ username, pincode: cell, area: cell.optional() });
type FieldRow = z.infer<typeof FieldRowSchema>;

const BackendRowSchema = z
  .object({ username, clientCode: cell.optional(), productCode: cell.optional() })
  .refine((r) => !!r.clientCode || !!r.productCode, {
    message: 'fill Client Code, Product Code, or both',
  });
type BackendRow = z.infer<typeof BackendRowSchema>;

const KycRowSchema = z.object({ username, unitCode: cell });
type KycRow = z.infer<typeof KycRowSchema>;

/** One resolved write: N scope assignments and/or one unit grant for a user. */
interface ScopeWorkbookInput {
  userId: string;
  scope?: { dimension: string; entityIds: number[] }[];
  unitIds?: number[];
}

/** username → {id, role}, or a per-row error on the Username column. */
async function resolveUser(
  name: string,
): Promise<{ userId: string; role: string } | { column: string; message: string }> {
  const userId = await repo.userIdByUsername(name);
  if (!userId) return { column: 'Username', message: 'unknown or inactive user' };
  const role = (await repo.targetRole(userId))!;
  return { userId, role };
}

const FIELD_SPEC: ImportSpec<FieldRow, ScopeWorkbookInput> = {
  resource: 'user_scope_assignments',
  columns: [
    { id: 'username', header: 'Username', required: true },
    { id: 'pincode', header: 'Pincode', required: true },
    { id: 'area', header: 'Area' },
  ],
  schema: FieldRowSchema,
  sampleRows: [
    { username: 'jdoe', pincode: '400001', area: '' }, // whole pincode — every area
    { username: 'jdoe', pincode: '400001', area: 'FORT' }, // one specific area
  ],
  async resolve(row): Promise<ResolveResult<ScopeWorkbookInput>> {
    const u = await resolveUser(row.username);
    if ('column' in u) return { ok: false, errors: [u] };
    const dimension = row.area ? 'AREA' : 'PINCODE';
    const allowed = await repo.roleDimensions(u.role);
    if (!allowed.has(dimension))
      return {
        ok: false,
        errors: [
          {
            column: 'Username',
            message: `pincode/area scope is not enabled for the user's role (${u.role})`,
          },
        ],
      };
    if (row.area) {
      const id = await repo.locationIdByPincodeArea(row.pincode, row.area);
      if (id === undefined)
        return { ok: false, errors: [{ column: 'Area', message: 'unknown pincode + area pair' }] };
      return { ok: true, value: { userId: u.userId, scope: [{ dimension, entityIds: [id] }] } };
    }
    const ids = await repo.locationIdsByPincode(row.pincode);
    if (ids.length === 0) return { ok: false, errors: [{ column: 'Pincode', message: 'unknown pincode' }] };
    return { ok: true, value: { userId: u.userId, scope: [{ dimension, entityIds: ids }] } };
  },
};

const BACKEND_SPEC: ImportSpec<BackendRow, ScopeWorkbookInput> = {
  resource: 'user_scope_assignments',
  columns: [
    { id: 'username', header: 'Username', required: true },
    { id: 'clientCode', header: 'Client Code' },
    { id: 'productCode', header: 'Product Code' },
  ],
  schema: BackendRowSchema,
  sampleRows: [
    { username: 'asmith', clientCode: 'HDFC', productCode: 'HOME_LOAN' }, // both in one row
    { username: 'asmith', clientCode: 'ICICI', productCode: '' }, // client only
  ],
  async resolve(row): Promise<ResolveResult<ScopeWorkbookInput>> {
    const u = await resolveUser(row.username);
    if ('column' in u) return { ok: false, errors: [u] };
    const allowed = await repo.roleDimensions(u.role);
    const scope: { dimension: string; entityIds: number[] }[] = [];
    const errors: { column: string; message: string }[] = [];
    const wants: { code: string | undefined; dimension: string; column: string }[] = [
      { code: row.clientCode, dimension: 'CLIENT', column: 'Client Code' },
      { code: row.productCode, dimension: 'PRODUCT', column: 'Product Code' },
    ];
    for (const w of wants) {
      if (!w.code) continue;
      if (!allowed.has(w.dimension)) {
        errors.push({
          column: w.column,
          message: `${w.dimension} scope is not enabled for the user's role (${u.role})`,
        });
        continue;
      }
      const id = await repo.catalogIdByCode(dimensionDef(w.dimension)!, w.code);
      if (id === undefined)
        errors.push({ column: w.column, message: `unknown ${w.dimension} code ${w.code}` });
      else scope.push({ dimension: w.dimension, entityIds: [id] });
    }
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, value: { userId: u.userId, scope } };
  },
};

const KYC_SPEC: ImportSpec<KycRow, ScopeWorkbookInput> = {
  resource: 'user_kyc_unit_access',
  columns: [
    { id: 'username', header: 'Username', required: true },
    { id: 'unitCode', header: 'Unit Code', required: true },
  ],
  schema: KycRowSchema,
  sampleRows: [{ username: 'kverma', unitCode: 'RESI' }],
  async resolve(row): Promise<ResolveResult<ScopeWorkbookInput>> {
    const u = await resolveUser(row.username);
    if ('column' in u) return { ok: false, errors: [u] };
    // Unit grants gate OFFICE assignment eligibility (ADR-0073) — office-pool role only, data-driven.
    if (u.role !== (await kycRepo.officePoolRole()))
      return {
        ok: false,
        errors: [
          {
            column: 'Username',
            message: `unit grants apply to the KYC/office-pool role only — the user's role is ${u.role}`,
          },
        ],
      };
    const unitId = await kycRepo.unitIdByCode(row.unitCode);
    if (unitId === undefined)
      return { ok: false, errors: [{ column: 'Unit Code', message: `unknown unit code ${row.unitCode}` }] };
    return { ok: true, value: { userId: u.userId, unitIds: [unitId] } };
  },
};

/** Writes one resolved row: scope assignments via the audited add; unit grants additively. */
async function processRow(input: ScopeWorkbookInput, actorId: string): Promise<void> {
  for (const s of input.scope ?? []) {
    const before = await repo.listForUser(input.userId);
    await repo.add(input.userId, s.dimension, { entityIds: s.entityIds }, actorId, before);
  }
  if (input.unitIds?.length) await kycRepo.addForUser(input.userId, input.unitIds, actorId);
}

/** A sheet bound to its spec's generics once — the workbook loop stays heterogeneity-free. */
interface SheetRunner {
  name: string;
  columns: ImportSpec<unknown>['columns'];
  sampleRows: Record<string, string | number>[];
  preview(buf: Buffer, sheet?: string): ReturnType<typeof runImportPreview>;
  confirm(
    buf: Buffer,
    actorId: string,
    fileName: string | undefined,
    sheet?: string,
  ): ReturnType<typeof runImportConfirm>;
}
function mkRunner<TFile>(name: string, spec: ImportSpec<TFile, ScopeWorkbookInput>): SheetRunner {
  return {
    name,
    columns: spec.columns,
    sampleRows: spec.sampleRows ?? [],
    preview: (buf, sheet) => runImportPreview(buf, spec, sheet !== undefined ? { sheet } : undefined),
    confirm: (buf, actorId, fileName, sheet) =>
      runImportConfirm(
        buf,
        spec,
        (input) => processRow(input, actorId),
        { userId: actorId, ...(fileName !== undefined ? { fileName } : {}) },
        sheet !== undefined ? { sheet } : undefined,
      ),
  };
}

const SHEETS: SheetRunner[] = [
  mkRunner(SCOPE_SHEET_FIELD, FIELD_SPEC),
  mkRunner(SCOPE_SHEET_BACKEND, BACKEND_SPEC),
  mkRunner(SCOPE_SHEET_KYC, KYC_SPEC),
];

/** Which roles a sheet applies to, from the LIVE wiring (hardcoded role lists would drift). */
async function sheetRoleLines(): Promise<{ field: string; backend: string; kyc: string }> {
  const wiring = await repo.allRoleDimensions();
  const rolesWith = (dims: string[]): string =>
    [...new Set(wiring.filter((w) => dims.includes(w.dimensionCode)).map((w) => w.roleCode))].join(', ') ||
    '(none wired)';
  return {
    field: rolesWith(['PINCODE', 'AREA']),
    backend: rolesWith(['CLIENT', 'PRODUCT']),
    kyc: (await kycRepo.officePoolRole()) ?? '(no office-pool role configured)',
  };
}

/** The trailing "How this sheet works" guidance column (owner 2026-07-11: the meaning must be ON
 *  the sheet itself, not only on the Notes tab). The importer maps columns by header and ignores
 *  unknown ones, so the guidance column never interferes with re-uploading the filled template. */
const GUIDE_HEADER = 'How this sheet works (leave this column as-is)';
const GUIDE_COL = { id: 'guide', header: GUIDE_HEADER };
const SHEET_GUIDES: Record<string, string[]> = {
  [SCOPE_SHEET_FIELD]: [
    'Area left BLANK = assigns ALL areas of the pincode',
    'Area filled = assigns only that one area of the pincode',
  ],
  [SCOPE_SHEET_BACKEND]: [
    'Each filled cell = one assignment — fill Client Code, Product Code, or both',
    'Client only is fine too (leave Product Code blank)',
  ],
  [SCOPE_SHEET_KYC]: ['Grants which KYC units this user can be assigned — ADDS to existing grants'],
};

/** The role-shaped 3-sheet template + a generated Notes sheet. */
export async function scopeWorkbookTemplate(): Promise<Buffer> {
  const roles = await sheetRoleLines();
  return buildWorkbookTemplate(
    SHEETS.map((s) => ({
      name: s.name,
      columns: [...s.columns, GUIDE_COL],
      sampleRows: s.sampleRows.map((row, i) => ({ ...row, guide: SHEET_GUIDES[s.name]?.[i] ?? '' })),
    })),
    {
      notes: [
        'HOW TO FILL THIS WORKBOOK (one sheet per user type — leave a sheet empty to skip it)',
        `"${SCOPE_SHEET_FIELD}" — Username + Pincode (+ optional Area). Blank Area = ALL areas of that pincode; a filled Area assigns that one area. For roles: ${roles.field}.`,
        `"${SCOPE_SHEET_BACKEND}" — Username + Client Code and/or Product Code; each filled cell becomes one assignment. For roles: ${roles.backend}.`,
        `"${SCOPE_SHEET_KYC}" — Username + Unit Code; grants KYC/office assignment eligibility (not data scope). For role: ${roles.kyc}.`,
        'A row whose user/role does not match the sheet is rejected as a row error — the rest of the file still imports.',
        'Re-importing an existing assignment or grant is safe (it re-activates, never duplicates).',
        'Keep this file XLSX. A CSV upload works too: use the headers of exactly ONE sheet (the importer detects which).',
      ],
    },
  );
}

const XLSX_MAGIC = 'PK';
const isXlsx = (buf: Buffer): boolean => buf.subarray(0, 2).toString('latin1') === XLSX_MAGIC;

/** CSV fallback: detect WHICH sheet's headers the single-sheet file carries (first line sniff). */
function csvSheet(buf: Buffer): SheetRunner {
  const firstLine = buf.toString('utf8').split(/\r?\n/, 1)[0] ?? '';
  if (/pincode/i.test(firstLine)) return SHEETS[0]!;
  if (/client\s*code|product\s*code/i.test(firstLine)) return SHEETS[1]!;
  if (/unit\s*code/i.test(firstLine)) return SHEETS[2]!;
  throw AppError.badRequest('UNKNOWN_SCOPE_SHEET', {
    hint: `a CSV must carry the headers of exactly one sheet: "${SCOPE_SHEET_FIELD}" (Username, Pincode, Area), "${SCOPE_SHEET_BACKEND}" (Username, Client Code, Product Code) or "${SCOPE_SHEET_KYC}" (Username, Unit Code)`,
  });
}

/** The sheets to run for an upload: all three (by name) for a workbook; the sniffed one for a CSV. */
function sheetsFor(buf: Buffer): { runner: SheetRunner; sheet?: string }[] {
  if (isXlsx(buf)) return SHEETS.map((s) => ({ runner: s, sheet: s.name }));
  return [{ runner: csvSheet(buf) }];
}

export async function scopeWorkbookPreview(buf: Buffer): Promise<OnboardingPreviewResult> {
  const sheets = [];
  for (const { runner, sheet } of sheetsFor(buf)) {
    const r = await runner.preview(buf, sheet);
    sheets.push({ name: runner.name, ...r, pendingRows: 0 }); // no cross-sheet projections here
  }
  return { sheets };
}

export async function scopeWorkbookConfirm(
  buf: Buffer,
  actorId: string,
  fileName: string | undefined,
): Promise<OnboardingConfirmResult> {
  const sheets = [];
  for (const { runner, sheet } of sheetsFor(buf)) {
    const r = await runner.confirm(buf, actorId, fileName, sheet);
    sheets.push({ name: runner.name, ...r });
  }
  return { sheets };
}
