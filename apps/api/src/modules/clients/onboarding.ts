import type {
  Client,
  ImportRowError,
  OnboardingConfirmResult,
  OnboardingPreviewResult,
  OnboardingSheetConfirm,
  OnboardingSheetPreview,
} from '@crm2/sdk';
import {
  type ImportColumn,
  type ImportSpec,
  assertImportable,
  runImportConfirm,
  runImportPreview,
} from '../../platform/import/index.js';
import { logger } from '@crm2/logger';
import { countImportRows, parseImportFile } from '../../platform/import/format.js';
import { importLogRepository } from '../../platform/import/importLog.repository.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { MASTER_IMPORT_COLUMNS, MASTER_IMPORT_SAMPLE } from '../shared/masterDataImport.js';
import { clientService } from './service.js';
import { productService, PRODUCT_IMPORT_SPEC } from '../products/service.js';
import { productRepository } from '../products/repository.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { rateTypeService } from '../rateTypes/service.js';
import { clientProductRepository as cpRepo } from '../cpv/repository.js';
import { clientProductService, cpvUnitService } from '../cpv/service.js';
import { CPV_IMPORT_COLUMNS, CPV_IMPORT_SAMPLE, buildCpvUnitWorkbookSpec } from '../cpv/import.js';
import {
  RATE_TYPE_ASSIGNMENT_IMPORT_COLUMNS,
  RATE_TYPE_ASSIGNMENT_IMPORT_SAMPLE,
  buildRateTypeAssignmentSpec,
} from '../rateTypeAssignments/import.js';
import { rateTypeAssignmentRepository } from '../rateTypeAssignments/repository.js';
import { rateTypeAssignmentService } from '../rateTypeAssignments/service.js';
import { RATE_IMPORT_COLUMNS, RATE_IMPORT_SAMPLE, buildRateSpec } from '../rates/import.js';
import { rateService } from '../rates/service.js';
import {
  COMMISSION_RATE_IMPORT_COLUMNS,
  COMMISSION_RATE_IMPORT_SAMPLE,
  buildCommissionRateSpec,
} from '../commissionRates/import.js';
import { commissionRateService } from '../commissionRates/service.js';

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

// ── Onboarding workbook runner — preview (ADR-0092 S5) ──
//
// A cross-sheet salvage pass sits on top of each sheet's own module spec (§4.3): a row the module
// rejects (e.g. "unknown product code") is re-checked at the CODE level against DB-sets ∪ this
// workbook's own earlier-sheet declarations (never by parsing the module's error TEXT). Only the
// `Product Code` dimension is ever salvageable — Products is the only sheet this workbook lets the
// user declare fresh master data in; client/unit/rate-type/location/username all come from existing
// DB rows (no sheet creates them), so a module rejection on any OTHER column is a genuine, permanent
// error and is kept verbatim. On top of salvage, workbook-strict guards (UX-8(b)) apply — checks the
// standalone per-domain imports never make, because they don't know about "the rest of this workbook"
// or "which client this whole file is for": CLIENT_MISMATCH, CPV_LINK_MISSING, RATE_TYPE_NOT_ASSIGNED,
// UNKNOWN_RATE_TYPE, and the future-`effectiveFrom` honesty rule (a prerequisite row that won't be
// USABLE yet at confirm makes its referencing row an error, not pending).

/** One (product|null, unit|null, rate-type) wildcard tuple — ADR-0067 availability: covers a combo
 *  iff each non-null field matches. `null` = Universal (assigned to every product / every unit). */
interface AssignmentTuple {
  productCode: string | null;
  unitCode: string | null;
  rateTypeCode: string;
}

/** Everything the runner loads ONCE (client + DB code-sets) plus the projections it accumulates as it
 *  walks the sheets in `ONBOARDING_SHEET_NAMES` order — later sheets read projections earlier sheets
 *  registered. All "pending" sets are code-level (a row's own codes), never resolved to a numeric FK
 *  id — the thing they refer to doesn't exist in the DB yet. */
interface Ctx {
  now: Date;
  target: Client;
  dbProductCodes: Set<string>;
  pendingProductCodes: Set<string>;
  /** future-dated Products-sheet codes (effectiveFrom > now) → their effectiveFrom, ISO. A LATER
   *  sheet referencing one of these is an error, never pending (it won't be USABLE at confirm). */
  futureProductCodes: Map<string, string>;
  /** productCodes with an existing USABLE client_products link for the target client. */
  usableLinkProductCodes: Set<string>;
  /** productCodes the CPV sheet's own (non-error) rows will link for the target client (its own
   *  phase-1 — Task 13 creates the missing client_products link before the CPV row). */
  pendingLinkPairs: Set<string>;
  /** productCodes the CPV sheet declares with a future effectiveFrom → their effectiveFrom, ISO. */
  futureLinkPairs: Map<string, string>;
  activeRateTypeCodes: Set<string>;
  /** the target client's existing USABLE rate-type assignments. */
  dbAssignmentTuples: AssignmentTuple[];
  /** tuples the RateTypeAssignments sheet's own (non-error) rows will create for the target client. */
  pendingAssignmentTuples: AssignmentTuple[];
}

interface RowOutcome {
  status: 'valid' | 'pending' | 'error';
  errors: ImportRowError[];
}

const clientMismatchError = (rowNumber: number, code: string, target: string): ImportRowError => ({
  rowNumber,
  column: 'Client Code',
  message: `CLIENT_MISMATCH: row is for client ${code}, this import is for client ${target}`,
});

type ProductState = 'db' | 'pending' | 'future' | 'unknown';

const resolveProductState = (ctx: Ctx, code: string): ProductState => {
  if (ctx.dbProductCodes.has(code)) return 'db';
  if (ctx.pendingProductCodes.has(code)) return 'pending';
  if (ctx.futureProductCodes.has(code)) return 'future';
  return 'unknown';
};

/** Cross-sheet salvage for a `Product Code` cell (CPV/RTA/Rates/CommissionRates all reference the
 *  Products sheet the same way): DB ∪ this workbook's Products sheet ∪ "declared but not usable yet".
 *  Returns the row error to add, or `undefined` when the code resolves cleanly (DB or pending). */
const productGuardError = (
  ctx: Ctx,
  rowNumber: number,
  code: string,
  state: ProductState,
  moduleErrors: ImportRowError[],
): ImportRowError | undefined => {
  if (state === 'unknown')
    return (
      moduleErrors.find((e) => e.column === 'Product Code') ?? {
        rowNumber,
        column: 'Product Code',
        message: `unknown product code ${code}`,
      }
    );
  if (state === 'future')
    return {
      rowNumber,
      column: 'Product Code',
      message: `PRODUCT_NOT_YET_USABLE: product ${code} is not usable until ${ctx.futureProductCodes.get(code)} — see the Products sheet`,
    };
  return undefined;
};

/** ADR-0067 wildcard coverage: a tuple covers (productCode, unitCode, rateTypeCode) iff each non-null
 *  tuple field matches (`null` = Universal). */
const wildcardCovers = (
  tuples: AssignmentTuple[],
  productCode: string,
  unitCode: string,
  rateTypeCode: string,
): boolean =>
  tuples.some(
    (t) =>
      (t.productCode === null || t.productCode === productCode) &&
      (t.unitCode === null || t.unitCode === unitCode) &&
      t.rateTypeCode === rateTypeCode,
  );

/** Generic sheet driver: run the module's own machinery (`runImportPreview`, verbatim messages) for
 *  the caps/schema/resolve baseline, and independently re-parse the raw rows so `evaluate` can re-run
 *  the sheet's zod schema and decide salvage/guards at the code level. A row whose schema itself fails
 *  is never salvageable (kept as the module's verbatim error) — only a resolve-only rejection is a
 *  salvage candidate, and `evaluate` decides that by re-deriving against `Ctx`'s DB-sets ∪ projections. */
async function runSheet<TFile, TInput>(
  buffer: Buffer,
  sheetName: string,
  spec: ImportSpec<TFile, TInput>,
  evaluate: (data: TFile, rowNumber: number, moduleErrors: ImportRowError[]) => RowOutcome,
): Promise<OnboardingSheetPreview> {
  const [preview, rawRows] = await Promise.all([
    runImportPreview(buffer, spec, { sheet: sheetName }),
    parseImportFile(buffer, spec.columns, { sheet: sheetName }),
  ]);

  const errorsByRow = new Map<number, ImportRowError[]>();
  for (const e of preview.errors) {
    const list = errorsByRow.get(e.rowNumber);
    if (list) list.push(e);
    else errorsByRow.set(e.rowNumber, [e]);
  }

  let validRows = 0;
  let pendingRows = 0;
  const errors: ImportRowError[] = [];
  for (const row of rawRows) {
    const moduleErrors = errorsByRow.get(row.rowNumber) ?? [];
    const parsed = spec.schema.safeParse(row.data);
    if (!parsed.success) {
      errors.push(...moduleErrors);
      continue;
    }
    const outcome = evaluate(parsed.data, row.rowNumber, moduleErrors);
    if (outcome.status === 'valid') validRows += 1;
    else if (outcome.status === 'pending') pendingRows += 1;
    else errors.push(...outcome.errors);
  }

  return {
    name: sheetName,
    totalRows: rawRows.length,
    validRows,
    pendingRows,
    errorRows: rawRows.length - validRows - pendingRows,
    errors: errors.sort((a, b) => a.rowNumber - b.rowNumber),
  };
}

/** Products: `masterDataImportSpec` has no `resolve`, so a post-schema module error is always an
 *  in-file duplicate code (never salvageable — there's nothing upstream to cross-reference). Every
 *  other schema-valid row is `valid`; it registers itself as a (pending or future) Product Code for
 *  later sheets to reference. */
function evaluateProductsRow(
  ctx: Ctx,
  data: { code: string; effectiveFrom?: string | undefined },
  _rowNumber: number,
  moduleErrors: ImportRowError[],
): RowOutcome {
  if (moduleErrors.length > 0) return { status: 'error', errors: moduleErrors };
  const future = data.effectiveFrom !== undefined && new Date(data.effectiveFrom) > ctx.now;
  if (future) ctx.futureProductCodes.set(data.code, data.effectiveFrom!);
  else ctx.pendingProductCodes.add(data.code);
  return { status: 'valid', errors: [] };
}

/** CPV: only `Product Code` is salvageable. A `no usable client-product link` module error (this
 *  sheet's `resolveLink`) is DELIBERATELY ignored — client_products link creation is this row's own
 *  implicit phase-1 (Task 13 creates the link, then the CPV row), so a missing link is never this
 *  sheet's error; `productGuardError` only ever fires for a genuinely unresolvable product code. The
 *  row is `valid` only when BOTH the product is a real DB row AND the client-product link already
 *  exists — otherwise it's `pending` (phase-1 will create the link, or the product itself, at
 *  confirm), even though every one of its own codes already resolves fine. */
function evaluateCpvRow(
  ctx: Ctx,
  data: {
    clientCode: string;
    productCode: string;
    unitCode?: string | undefined;
    effectiveFrom?: string | undefined;
  },
  rowNumber: number,
  moduleErrors: ImportRowError[],
): RowOutcome {
  const otherErrors = moduleErrors.filter((e) => e.column !== 'Product Code');
  if (otherErrors.length > 0) return { status: 'error', errors: otherErrors };

  const errors: ImportRowError[] = [];
  if (data.clientCode !== ctx.target.code)
    errors.push(clientMismatchError(rowNumber, data.clientCode, ctx.target.code));

  const productState = resolveProductState(ctx, data.productCode);
  const productError = productGuardError(ctx, rowNumber, data.productCode, productState, moduleErrors);
  if (productError) errors.push(productError);

  if (errors.length > 0) return { status: 'error', errors };

  const dbLinked = ctx.usableLinkProductCodes.has(data.productCode);
  const future = data.effectiveFrom !== undefined && new Date(data.effectiveFrom) > ctx.now;
  if (future) ctx.futureLinkPairs.set(data.productCode, data.effectiveFrom!);
  else ctx.pendingLinkPairs.add(data.productCode);

  return { status: productState === 'db' && dbLinked ? 'valid' : 'pending', errors: [] };
}

/** RateTypeAssignments: only `Product Code` is salvageable (Unit Code / Rate Type Code have no
 *  producer sheet in this workbook — a module rejection there is genuine and non-projectable, so it
 *  flows straight to `otherErrors`). `resolve()` (rateTypeAssignments/import.ts) uppercases product/
 *  unit codes before its own DB lookup — mirrored here so a lowercase-typed code salvages the same
 *  way it would resolve for real. */
function evaluateRtaRow(
  ctx: Ctx,
  data: {
    clientCode: string;
    productCode?: string | undefined;
    unitCode?: string | undefined;
    rateTypeCode: string;
  },
  rowNumber: number,
  moduleErrors: ImportRowError[],
): RowOutcome {
  const otherErrors = moduleErrors.filter((e) => e.column !== 'Product Code');
  if (otherErrors.length > 0) return { status: 'error', errors: otherErrors };

  const errors: ImportRowError[] = [];
  if (data.clientCode !== ctx.target.code)
    errors.push(clientMismatchError(rowNumber, data.clientCode, ctx.target.code));

  let productState: ProductState | 'universal' = 'universal';
  if (data.productCode) {
    const code = data.productCode.toUpperCase();
    productState = resolveProductState(ctx, code);
    const productError = productGuardError(ctx, rowNumber, code, productState, moduleErrors);
    if (productError) errors.push(productError);
  }

  if (errors.length > 0) return { status: 'error', errors };

  // Registers regardless of this row's own valid/pending split — a fresh assignment combo (all its
  // own codes real) is exactly what an RTA row normally creates; a LATER Rates row referencing it is
  // `pending` either way (the combo itself won't exist in the DB until this workbook is confirmed).
  ctx.pendingAssignmentTuples.push({
    productCode: data.productCode ? data.productCode.toUpperCase() : null,
    unitCode: data.unitCode ? data.unitCode.toUpperCase() : null,
    rateTypeCode: data.rateTypeCode,
  });

  return { status: productState === 'pending' ? 'pending' : 'valid', errors: [] };
}

/** Rates: `Product Code` salvage, PLUS the two Rates-only guards (CPV_LINK_MISSING /
 *  RATE_TYPE_NOT_ASSIGNED), each checked against DB ∪ this workbook's own projections. The row is
 *  `pending` (not `valid`) if ANY of product / link / rate-type-assignment resolved only via a
 *  projection — it can't confirm until the sheet(s) it depends on are confirmed too. */
function evaluateRatesRow(
  ctx: Ctx,
  data: {
    clientCode: string;
    productCode: string;
    unitCode: string;
    clientRateType?: string | undefined;
  },
  rowNumber: number,
  moduleErrors: ImportRowError[],
): RowOutcome {
  const otherErrors = moduleErrors.filter((e) => e.column !== 'Product Code');
  if (otherErrors.length > 0) return { status: 'error', errors: otherErrors };

  const errors: ImportRowError[] = [];
  let pending = false;

  if (data.clientCode !== ctx.target.code)
    errors.push(clientMismatchError(rowNumber, data.clientCode, ctx.target.code));

  const productState = resolveProductState(ctx, data.productCode);
  const productError = productGuardError(ctx, rowNumber, data.productCode, productState, moduleErrors);
  if (productError) errors.push(productError);
  if (productState === 'pending') pending = true;

  // The link/rate-type-assignment checks only make sense once the product itself resolves.
  if (productState === 'db' || productState === 'pending') {
    const dbLinked = ctx.usableLinkProductCodes.has(data.productCode);
    const pendingLinked = ctx.pendingLinkPairs.has(data.productCode);
    if (!dbLinked && !pendingLinked) {
      const futureLink = ctx.futureLinkPairs.get(data.productCode);
      errors.push(
        futureLink !== undefined
          ? {
              rowNumber,
              column: 'Product Code',
              message: `CPV_LINK_NOT_YET_USABLE: the client-product link for ${ctx.target.code} + ${data.productCode} is not usable until ${futureLink} — see the CPV sheet`,
            }
          : {
              rowNumber,
              column: 'Product Code',
              message: `CPV_LINK_MISSING: no usable client-product link for ${ctx.target.code} + ${data.productCode}`,
            },
      );
    } else if (pendingLinked && !dbLinked) {
      pending = true;
    }

    if (data.clientRateType) {
      // The DB write resolves client_rate_type via `UPPER(...)` against rate_types.code (rates/repository.ts)
      // — mirror that here so the wildcard match uses the same canonical case.
      const rt = data.clientRateType.toUpperCase();
      const dbCovered = wildcardCovers(ctx.dbAssignmentTuples, data.productCode, data.unitCode, rt);
      const pendingCovered =
        !dbCovered && wildcardCovers(ctx.pendingAssignmentTuples, data.productCode, data.unitCode, rt);
      if (!dbCovered && !pendingCovered) {
        errors.push({
          rowNumber,
          column: 'Rate Type',
          message: `RATE_TYPE_NOT_ASSIGNED: rate type ${data.clientRateType} is not assigned to ${ctx.target.code} for product ${data.productCode} + unit ${data.unitCode}`,
        });
      } else if (pendingCovered) {
        pending = true;
      }
    }
  }

  if (errors.length > 0) return { status: 'error', errors };
  return { status: pending ? 'pending' : 'valid', errors: [] };
}

/** CommissionRates: `Product Code` salvage, PLUS UNKNOWN_RATE_TYPE (catalog-existence only — ADR-0050's
 *  unassigned-combo semantics are untouched; this only closes the silent-NULL for this NEW surface).
 *  No CPV/RTA linkage guard here — commission rates aren't gated by either. */
function evaluateCommissionRateRow(
  ctx: Ctx,
  data: {
    clientCode?: string | undefined;
    productCode?: string | undefined;
    fieldRateType: string;
  },
  rowNumber: number,
  moduleErrors: ImportRowError[],
): RowOutcome {
  const otherErrors = moduleErrors.filter((e) => e.column !== 'Product Code');
  if (otherErrors.length > 0) return { status: 'error', errors: otherErrors };

  const errors: ImportRowError[] = [];
  // blank clientCode = universal = allowed (ADR-0046) — never a mismatch.
  if (data.clientCode && data.clientCode !== ctx.target.code)
    errors.push(clientMismatchError(rowNumber, data.clientCode, ctx.target.code));

  if (!ctx.activeRateTypeCodes.has(data.fieldRateType))
    errors.push({
      rowNumber,
      column: 'Rate Type',
      message: `UNKNOWN_RATE_TYPE: rate type ${data.fieldRateType} is not in the active rate types catalog`,
    });

  let productState: ProductState | 'universal' = 'universal';
  if (data.productCode) {
    productState = resolveProductState(ctx, data.productCode);
    const productError = productGuardError(ctx, rowNumber, data.productCode, productState, moduleErrors);
    if (productError) errors.push(productError);
  }

  if (errors.length > 0) return { status: 'error', errors };
  return { status: productState === 'pending' ? 'pending' : 'valid', errors: [] };
}

/** Load the target client + every DB code-set/projection-seed the runner needs, ONCE per preview call
 *  (mirrors the per-request map-preloading each domain's own `build*Spec()` already does). Ids are
 *  converted to codes (`productCodeById`/`unitCodeById`) so DB rows and this-workbook projections share
 *  ONE code-level representation for the wildcard/pair matches — a pending product/link has no id yet. */
async function loadContext(target: Client): Promise<Ctx> {
  const [products, units, rateTypes, links] = await Promise.all([
    productService.options(),
    verificationUnitService.options(),
    rateTypeService.options(true),
    cpRepo.linkOptionsForImport(),
  ]);
  const productCodeById = new Map(products.map((p) => [p.id, p.code]));
  const unitCodeById = new Map(units.map((u) => [u.id, u.code]));

  // The target client's own USABLE rate-type assignments (ADR-0067/0069) — the DB half of the
  // RATE_TYPE_NOT_ASSIGNED wildcard match; a large `limit` reads them all (this is a preview-time
  // read, not a paginated list endpoint).
  const { items: assignments } = await rateTypeAssignmentRepository.list({
    clientId: target.id,
    active: true,
    sortColumn: 'a.id',
    sortOrder: 'asc',
    limit: 1_000_000,
    offset: 0,
  });

  return {
    now: new Date(),
    target,
    dbProductCodes: new Set(products.map((p) => p.code)),
    pendingProductCodes: new Set(),
    futureProductCodes: new Map(),
    usableLinkProductCodes: new Set(
      links
        .filter((l) => l.clientId === target.id)
        .map((l) => productCodeById.get(l.productId))
        .filter((code): code is string => code !== undefined),
    ),
    pendingLinkPairs: new Set(),
    futureLinkPairs: new Map(),
    activeRateTypeCodes: new Set(rateTypes.map((rt) => rt.code)),
    // An assignment pinned to a SPECIFIC product/unit whose id doesn't resolve in the USABLE-only
    // options maps (inactive / future-dated) is DROPPED — mapping the miss to `null` would silently
    // widen it to Universal in the wildcard matcher and make RATE_TYPE_NOT_ASSIGNED under-fire.
    // Correct per ADR-0017: an assignment pinned to a non-USABLE product/unit can't gate anything
    // at confirm either; it's operationally dead until its product/unit is USABLE again.
    dbAssignmentTuples: assignments.flatMap((a) => {
      const productCode = a.productId !== null ? productCodeById.get(a.productId) : null;
      const unitCode = a.verificationUnitId !== null ? unitCodeById.get(a.verificationUnitId) : null;
      if (productCode === undefined || unitCode === undefined) return [];
      return [{ productCode, unitCode, rateTypeCode: a.rateTypeCode }];
    }),
    pendingAssignmentTuples: [],
  };
}

/**
 * The onboarding workbook's preview pass (ADR-0092 S5, spec §4.3). Caps first — per-sheet AND the
 * total across all 5, both 413 `IMPORT_TOO_LARGE` above `importThreshold()` — before any DB loads or
 * row parsing. Then each sheet in `ONBOARDING_SHEET_NAMES` order (Products → CPV → RateTypeAssignments
 * → Rates → CommissionRates) through its own module spec, PLUS this runner's cross-sheet salvage +
 * workbook-strict guards (see the module docstring above). A sheet missing from the uploaded workbook
 * naturally reports zeros — `countImportRows`/`parseImportFile` already treat an absent worksheet as
 * zero rows, no special-casing needed here.
 */
export async function onboardingPreview(clientId: number, buffer: Buffer): Promise<OnboardingPreviewResult> {
  const target = await clientService.get(clientId); // 404 CLIENT_NOT_FOUND

  const counts = await Promise.all(
    ONBOARDING_SHEET_NAMES.map((name) => countImportRows(buffer, { sheet: name })),
  );
  let total = 0;
  for (const count of counts) {
    assertImportable(count);
    total += count;
  }
  assertImportable(total);

  const ctx = await loadContext(target);

  const products = await runSheet(buffer, 'Products', PRODUCT_IMPORT_SPEC, (data, rowNumber, moduleErrors) =>
    evaluateProductsRow(ctx, data, rowNumber, moduleErrors),
  );
  const cpv = await runSheet(
    buffer,
    'CPV',
    await buildCpvUnitWorkbookSpec(),
    (data, rowNumber, moduleErrors) => evaluateCpvRow(ctx, data, rowNumber, moduleErrors),
  );
  const rta = await runSheet(
    buffer,
    'RateTypeAssignments',
    await buildRateTypeAssignmentSpec(),
    (data, rowNumber, moduleErrors) => evaluateRtaRow(ctx, data, rowNumber, moduleErrors),
  );
  const rates = await runSheet(buffer, 'Rates', await buildRateSpec(), (data, rowNumber, moduleErrors) =>
    evaluateRatesRow(ctx, data, rowNumber, moduleErrors),
  );
  const commissionRates = await runSheet(
    buffer,
    'CommissionRates',
    await buildCommissionRateSpec(),
    (data, rowNumber, moduleErrors) => evaluateCommissionRateRow(ctx, data, rowNumber, moduleErrors),
  );

  return { sheets: [products, cpv, rta, rates, commissionRates] };
}

// ── Onboarding workbook runner — confirm (ADR-0092 S5) ──
//
// Sheets run strictly in `ONBOARDING_SHEET_NAMES` order; each sheet's module spec (and its guard
// `Ctx`) is rebuilt FRESH — via the SAME `build*Spec()` / `loadContext()` preview already uses —
// only AFTER the prior sheet has committed, so a later sheet's FK maps see the earlier sheet's real
// DB writes. There is no cross-sheet projection at confirm (unlike preview): `loadContext`'s
// `pending*`/`future*` fields start (and stay) empty. Note `evaluateCpvRow` can still return
// `pending` here via its DB-derived `dbLinked` flag — that's fine: `withGuard` only blocks on
// `error`, and a genuinely missing link is then caught by the module's native `resolve` ("no usable
// client-product link"). The guard's `error` branch is the workbook-strict layer this sheet needs
// (CLIENT_MISMATCH / CPV_LINK_MISSING / RATE_TYPE_NOT_ASSIGNED / UNKNOWN_RATE_TYPE) on top of each
// module's own native FK resolution (unchanged).

/** Wrap a sheet's `resolve` with the SAME guard function preview uses: the guard runs first (against
 *  a DB-state-only `Ctx`), and a failing row becomes a `ResolveResult` error — it never reaches the
 *  module's own `resolve`, so it's never processed/written. A passing row falls through to the
 *  module's native `resolve` unchanged (the ordinary FK-code-to-id lookup). */
function withGuard<TFile, TInput>(
  spec: ImportSpec<TFile, TInput>,
  guard: (data: TFile, rowNumber: number) => RowOutcome,
): ImportSpec<TFile, TInput> {
  return {
    ...spec,
    resolve: async (input, rowNumber) => {
      const outcome = guard(input, rowNumber);
      if (outcome.status === 'error')
        return {
          ok: false,
          errors: outcome.errors.map((e) => ({ column: e.column, message: e.message })),
        };
      if (!spec.resolve) return { ok: true, value: input as unknown as TInput };
      return spec.resolve(input, rowNumber);
    },
  };
}

/**
 * The onboarding workbook's confirm pass (ADR-0092 S5, spec §4.3): ordered rebuild-and-commit. Caps
 * re-asserted exactly like preview (413 per-sheet + total) before any DB work. Every sheet — including
 * a zero-row one — still runs and still writes its `import_log` audit row; a sheet's row failures
 * never abort a later sheet (the same partial-import semantics a standalone import already has).
 */
export async function onboardingConfirm(
  clientId: number,
  buffer: Buffer,
  meta: { userId: string; fileName?: string | undefined },
): Promise<OnboardingConfirmResult> {
  const target = await clientService.get(clientId); // 404 CLIENT_NOT_FOUND

  const counts = await Promise.all(
    ONBOARDING_SHEET_NAMES.map((name) => countImportRows(buffer, { sheet: name })),
  );
  let total = 0;
  for (const count of counts) {
    assertImportable(count);
    total += count;
  }
  assertImportable(total);

  const sheets: OnboardingSheetConfirm[] = [];

  // Products — global master data, not client-scoped: no workbook-strict guard applies. Mirrors
  // PRODUCT_IMPORT_SPEC's own `importConfirm` process (products/service.ts) verbatim.
  const products = await runImportConfirm(
    buffer,
    PRODUCT_IMPORT_SPEC,
    async (input) => {
      await productRepository.create(input, meta.userId);
    },
    meta,
    { sheet: 'Products' },
  );
  sheets.push({ name: 'Products', ...products });

  // CPV — two phases, two `import_log` rows. Phase 1: create every DISTINCT (target client, product)
  // link the sheet needs, idempotently — a 409 (already linked) counts as success, mirroring what a
  // re-run of this same workbook should do. Rows for the wrong client or an unresolvable product are
  // skipped here (never linked) — they surface as their own row error in phase 2 below, same as any
  // other guard/native-resolve failure.
  const cpvColumnsSpec = await buildCpvUnitWorkbookSpec(); // columns/schema only — its resolve (stale
  // link map) is never invoked here; phase 2 rebuilds the spec fresh, after phase 1 commits.
  const cpvRawRows = await parseImportFile(buffer, cpvColumnsSpec.columns, { sheet: 'CPV' });
  const productOptions = await productService.options();
  const productIdByCode = new Map(productOptions.map((p) => [p.code, p.id]));
  // The link carries the EARLIEST `Effective From` among the pair's rows (a row without one means
  // "effective now", which beats any future date) — so a future-only pair yields a future-dated,
  // not-yet-USABLE link and its dependent unit/rate rows row-error at confirm, exactly as preview
  // reported (CPV_LINK_NOT_YET_USABLE). Mirrors the standalone link import, which also carries
  // Effective From into `client_products`.
  const linkPairs = new Map<number, { clientId: number; productId: number; effectiveFrom?: string }>();
  for (const row of cpvRawRows) {
    const parsed = cpvColumnsSpec.schema.safeParse(row.data);
    if (!parsed.success) continue; // schema-invalid — phase 2 reports this row's own error
    if (parsed.data.clientCode !== target.code) continue; // CLIENT_MISMATCH — not this phase's job
    const productId = productIdByCode.get(parsed.data.productCode);
    if (productId === undefined) continue; // unknown product — phase 2 reports this row's own error
    const rowEffectiveFrom = parsed.data.effectiveFrom;
    const prev = linkPairs.get(productId);
    const keepPrev =
      prev !== undefined &&
      (prev.effectiveFrom === undefined ||
        (rowEffectiveFrom !== undefined && Date.parse(prev.effectiveFrom) <= Date.parse(rowEffectiveFrom)));
    if (!keepPrev) {
      linkPairs.set(productId, {
        clientId: target.id,
        productId,
        ...(rowEffectiveFrom !== undefined ? { effectiveFrom: rowEffectiveFrom } : {}),
      });
    }
  }
  const linkStarted = Date.now();
  let linkSuccessRows = 0;
  for (const pair of linkPairs.values()) {
    try {
      await clientProductService.create(pair, meta.userId);
      linkSuccessRows += 1;
    } catch (e) {
      // a 409 (CLIENT_PRODUCT_EXISTS) = already linked = success for onboarding purposes; any other
      // failure just isn't counted — the loop never aborts (partial-import semantics). A swallowed
      // non-409 failure is NOT silent overall: the missing link makes this product's phase-2 unit
      // rows fail with the module's own "no usable client-product link" row error.
      if (e instanceof AppError && e.status === HTTP_STATUS.CONFLICT) linkSuccessRows += 1;
    }
  }
  const linkDurationMs = Date.now() - linkStarted;
  await importLogRepository.record({
    resource: 'client_products',
    fileName: meta.fileName,
    totalRows: linkPairs.size,
    successRows: linkSuccessRows,
    failedRows: linkPairs.size - linkSuccessRows,
    durationMs: linkDurationMs,
    actorId: meta.userId,
  });
  logger.info('data import', {
    event: 'import',
    resource: 'client_products',
    totalRows: linkPairs.size,
    successRows: linkSuccessRows,
    failedRows: linkPairs.size - linkSuccessRows,
    durationMs: linkDurationMs,
    actorId: meta.userId,
  });

  // Phase 2: the unit rows, through the module's own spec — rebuilt fresh so its link map sees
  // phase 1's writes — guarded for CLIENT_MISMATCH (the module's own `resolve` has no target-client
  // concept; CPV_LINK_MISSING is already native here, since the link map above just caught up).
  const cpvCtx = await loadContext(target);
  const cpv = await runImportConfirm(
    buffer,
    withGuard(await buildCpvUnitWorkbookSpec(), (data, rowNumber) =>
      evaluateCpvRow(cpvCtx, data, rowNumber, []),
    ),
    async (input) => {
      await cpvUnitService.create(input, meta.userId);
    },
    meta,
    { sheet: 'CPV' },
  );
  sheets.push({ name: 'CPV', ...cpv });

  // RateTypeAssignments — guarded for CLIENT_MISMATCH (the module's own `resolve` has no target-client
  // concept either).
  const rtaCtx = await loadContext(target);
  const rta = await runImportConfirm(
    buffer,
    withGuard(await buildRateTypeAssignmentSpec(), (data, rowNumber) =>
      evaluateRtaRow(rtaCtx, data, rowNumber, []),
    ),
    async (input) => {
      await rateTypeAssignmentService.create(input, meta.userId);
    },
    meta,
    { sheet: 'RateTypeAssignments' },
  );
  sheets.push({ name: 'RateTypeAssignments', ...rta });

  // Rates — guarded for CLIENT_MISMATCH / CPV_LINK_MISSING / RATE_TYPE_NOT_ASSIGNED, none of which the
  // module's own `resolve` checks (a rate can otherwise be written for an unlinked product, or a rate
  // type never assigned to this client).
  const ratesCtx = await loadContext(target);
  const rates = await runImportConfirm(
    buffer,
    withGuard(await buildRateSpec(), (data, rowNumber) => evaluateRatesRow(ratesCtx, data, rowNumber, [])),
    async (input) => {
      await rateService.create(input, meta.userId);
    },
    meta,
    { sheet: 'Rates' },
  );
  sheets.push({ name: 'Rates', ...rates });

  // CommissionRates — guarded for CLIENT_MISMATCH (blank clientCode = universal, never a mismatch) and
  // UNKNOWN_RATE_TYPE (the module's own `resolve` silently resolves an unknown code to a NULL FK
  // instead of erroring — this guard is the only thing that catches it).
  const commissionCtx = await loadContext(target);
  const commissionRates = await runImportConfirm(
    buffer,
    withGuard(await buildCommissionRateSpec(), (data, rowNumber) =>
      evaluateCommissionRateRow(commissionCtx, data, rowNumber, []),
    ),
    async (input) => {
      await commissionRateService.create(input, meta.userId);
    },
    meta,
    { sheet: 'CommissionRates' },
  );
  sheets.push({ name: 'CommissionRates', ...commissionRates });

  return { sheets };
}
