import { z } from 'zod';
import type { CreateClientProductInput, CreateCpvUnitInput } from '@crm2/sdk';
import type { ImportColumn, ImportSpec, ResolveResult } from '../../platform/import/index.js';
import { parseIsoDate } from '../../platform/import/parsers.js';
import { clientService } from '../clients/service.js';
import { productService } from '../products/service.js';
import { verificationUnitService } from '../verificationUnits/service.js';
import { clientProductRepository as cpRepo } from './repository.js';

/**
 * CPV link import (B-14): a row carries the human client + product CODES; the engine's async
 * `resolve` maps them to the numeric FK ids `CreateClientProductSchema` needs. This file-shape
 * schema validates the SPREADSHEET row (codes); the create-input schema (numeric ids) is enforced
 * downstream by `clientProductService.create`, which also surfaces a duplicate link as 409 per row.
 */
const ClientProductImportFileSchema = z.object({
  clientCode: z.string().min(1),
  productCode: z.string().min(1),
  effectiveFrom: z.string().datetime().optional(),
});
type ClientProductImportFile = z.infer<typeof ClientProductImportFileSchema>;

const CP_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code', required: true },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

const CP_IMPORT_SAMPLE: Record<string, string> = {
  clientCode: 'HDFC',
  productCode: 'HOME_LOAN',
};

/** Template spec (no `resolve` — the template only needs the columns + sample, never FK lookups). */
export const CP_TEMPLATE_SPEC: ImportSpec<ClientProductImportFile> = {
  resource: 'client_products',
  columns: CP_IMPORT_COLUMNS,
  schema: ClientProductImportFileSchema,
  sample: CP_IMPORT_SAMPLE,
};

/**
 * Build the CPV-link ImportSpec for ONE request: preload the client/product code→id maps ONCE (the
 * engine's `resolve` is per-row, so we close over the maps instead of re-querying per row). Maps are
 * USABLE-only (clients/products `options()` = active AND in effect), so an inactive/future code won't
 * resolve — by design. Returns the spec the service feeds to `runImportPreview`/`runImportConfirm`.
 */
export async function buildClientProductSpec(): Promise<
  ImportSpec<ClientProductImportFile, CreateClientProductInput>
> {
  const [clients, products] = await Promise.all([clientService.options(), productService.options()]);
  const clientMap = new Map(clients.map((c) => [c.code, c.id]));
  const productMap = new Map(products.map((p) => [p.code, p.id]));

  const resolve = async (
    input: ClientProductImportFile,
  ): Promise<ResolveResult<CreateClientProductInput>> => {
    const errors: { column: string; message: string }[] = [];

    const clientId = clientMap.get(input.clientCode);
    if (clientId === undefined)
      errors.push({ column: 'Client Code', message: `unknown client code ${input.clientCode}` });
    const productId = productMap.get(input.productCode);
    if (productId === undefined)
      errors.push({ column: 'Product Code', message: `unknown product code ${input.productCode}` });

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        clientId: clientId!,
        productId: productId!,
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    };
  };

  return {
    resource: 'client_products',
    columns: CP_IMPORT_COLUMNS,
    schema: ClientProductImportFileSchema,
    sample: CP_IMPORT_SAMPLE,
    resolve,
  };
}

/**
 * CPV-unit import (IE-DEFER-2): a row carries the human client + product + unit CODES; the engine's
 * async `resolve` maps the client+product pair → the existing client_product id and the unit code →
 * the verification_unit id that `CreateCpvUnitSchema` needs. This file-shape schema validates the
 * SPREADSHEET row (codes); the create-input schema (numeric ids) is enforced downstream by
 * `cpvUnitService.create`, which also surfaces a duplicate enablement as 409 per row. Mirrors the
 * clientProduct-link import; one extra FK (the unit) and a composite client+product → link lookup.
 */
const CpvUnitImportFileSchema = z.object({
  clientCode: z.string().min(1),
  productCode: z.string().min(1),
  unitCode: z.string().min(1),
  effectiveFrom: z.string().datetime().optional(),
});
type CpvUnitImportFile = z.infer<typeof CpvUnitImportFileSchema>;

// Exported additively (ADR-0092 S4): the Client Setup onboarding workbook reuses this manifest as
// one of its 5 sheets — no behavior change to the existing CPV import/template.
export const CPV_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code', required: true },
  { id: 'unitCode', header: 'Unit Code', required: true },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

export const CPV_IMPORT_SAMPLE: Record<string, string> = {
  clientCode: 'HDFC',
  productCode: 'HOME_LOAN',
  unitCode: 'RESI',
};

/** Template spec (no `resolve` — the template only needs the columns + sample, never FK lookups). */
export const CPV_TEMPLATE_SPEC: ImportSpec<CpvUnitImportFile> = {
  resource: 'client_product_verification_units',
  columns: CPV_IMPORT_COLUMNS,
  schema: CpvUnitImportFileSchema,
  sample: CPV_IMPORT_SAMPLE,
};

/**
 * Preload the client/product/unit code→id maps + the client_product link map ONCE (shared by the
 * strict CPV-unit spec below and its workbook variant — the engine's `resolve` is per-row, so both
 * close over the same maps instead of re-querying per row). Maps are USABLE-only (active AND in
 * effect), so an inactive/future code or link won't resolve — by design, mirroring the clientProduct
 * import.
 */
async function loadCpvUnitMaps(): Promise<{
  clientMap: Map<string, number>;
  productMap: Map<string, number>;
  unitMap: Map<string, number>;
  linkMap: Map<string, number>;
}> {
  const [clients, products, units, links] = await Promise.all([
    clientService.options(),
    productService.options(),
    verificationUnitService.options(),
    cpRepo.linkOptionsForImport(),
  ]);
  return {
    clientMap: new Map(clients.map((c) => [c.code, c.id])),
    productMap: new Map(products.map((p) => [p.code, p.id])),
    unitMap: new Map(units.map((u) => [u.code, u.id])),
    // composite key `${clientId}:${productId}` → client_product id (only USABLE links present).
    linkMap: new Map(links.map((l) => [`${l.clientId}:${l.productId}`, l.id])),
  };
}

/** clientCode/productCode → ids, pushing 'unknown ... code' row errors (shared by both CPV-unit specs). */
function resolveClientAndProduct(
  clientCode: string,
  productCode: string,
  maps: Pick<Awaited<ReturnType<typeof loadCpvUnitMaps>>, 'clientMap' | 'productMap'>,
  errors: { column: string; message: string }[],
): { clientId: number | undefined; productId: number | undefined } {
  const clientId = maps.clientMap.get(clientCode);
  if (clientId === undefined)
    errors.push({ column: 'Client Code', message: `unknown client code ${clientCode}` });
  const productId = maps.productMap.get(productCode);
  if (productId === undefined)
    errors.push({ column: 'Product Code', message: `unknown product code ${productCode}` });
  return { clientId, productId };
}

/**
 * Once both ids resolved, the existing USABLE client_product link id (shared by both CPV-unit specs).
 * Only meaningful once both codes resolved — otherwise the composite key is meaningless.
 */
function resolveLink(
  clientId: number | undefined,
  productId: number | undefined,
  clientCode: string,
  productCode: string,
  maps: Pick<Awaited<ReturnType<typeof loadCpvUnitMaps>>, 'linkMap'>,
  errors: { column: string; message: string }[],
): number | undefined {
  if (clientId === undefined || productId === undefined) return undefined;
  const clientProductId = maps.linkMap.get(`${clientId}:${productId}`);
  if (clientProductId === undefined)
    errors.push({
      column: 'Product Code',
      message: `no usable client-product link for ${clientCode} + ${productCode}`,
    });
  return clientProductId;
}

/**
 * Build the CPV-unit ImportSpec for ONE request: preload the code→id maps (`loadCpvUnitMaps`) and map
 * each row to the numeric-id `CreateCpvUnitInput`. Returns the spec the service feeds to
 * `runImportPreview`/`runImportConfirm`.
 */
export async function buildCpvUnitSpec(): Promise<ImportSpec<CpvUnitImportFile, CreateCpvUnitInput>> {
  const maps = await loadCpvUnitMaps();

  const resolve = async (input: CpvUnitImportFile): Promise<ResolveResult<CreateCpvUnitInput>> => {
    const errors: { column: string; message: string }[] = [];

    const { clientId, productId } = resolveClientAndProduct(
      input.clientCode,
      input.productCode,
      maps,
      errors,
    );
    const verificationUnitId = maps.unitMap.get(input.unitCode);
    if (verificationUnitId === undefined)
      errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });
    const clientProductId = resolveLink(
      clientId,
      productId,
      input.clientCode,
      input.productCode,
      maps,
      errors,
    );

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        clientProductId: clientProductId!,
        verificationUnitId: verificationUnitId!,
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    };
  };

  return {
    resource: 'client_product_verification_units',
    columns: CPV_IMPORT_COLUMNS,
    schema: CpvUnitImportFileSchema,
    sample: CPV_IMPORT_SAMPLE,
    resolve,
  };
}

/**
 * WORKBOOK-only CPV-unit import delta (ADR-0092 S5): the Client Setup onboarding workbook's CPV sheet
 * needs Unit Code OPTIONAL — blank or literal 'UNIVERSAL' (case-insensitive) enables ALL units for the
 * client+product (`verificationUnitId: null`, ADR-0074; `CreateCpvUnitSchema.verificationUnitId` is
 * already `nullish()`). Mirrors rate-type-assignments' blank-code-is-Universal columns. The standalone
 * single-sheet CPV import above (`CpvUnitImportFileSchema`/`CPV_IMPORT_COLUMNS`/`buildCpvUnitSpec`) is
 * untouched — it keeps unitCode REQUIRED.
 */
export const WorkbookCpvUnitImportFileSchema = z.object({
  clientCode: z.string().min(1),
  productCode: z.string().min(1),
  // blank or 'UNIVERSAL' (case-insensitive, trimmed) = Universal, resolved to null (ADR-0074).
  unitCode: z.string().optional(),
  effectiveFrom: z.string().datetime().optional(),
});
type WorkbookCpvUnitImportFile = z.infer<typeof WorkbookCpvUnitImportFileSchema>;

export const WORKBOOK_CPV_IMPORT_COLUMNS: ImportColumn[] = [
  { id: 'clientCode', header: 'Client Code', required: true },
  { id: 'productCode', header: 'Product Code', required: true },
  { id: 'unitCode', header: 'Unit Code' },
  { id: 'effectiveFrom', header: 'Effective From', parse: parseIsoDate },
];

/** blank/absent or 'UNIVERSAL' (any case, trimmed) ⇒ Universal (ADR-0074). */
function isUniversalUnitCode(unitCode: string | undefined): boolean {
  const trimmed = unitCode?.trim();
  return !trimmed || trimmed.toUpperCase() === 'UNIVERSAL';
}

/**
 * Build the WORKBOOK CPV-unit ImportSpec: same code→id maps + link resolution as `buildCpvUnitSpec`;
 * only the unit-code handling differs (blank/'UNIVERSAL' ⇒ null, else the same unitMap lookup + error).
 * Additive-only — not yet wired into any route; the onboarding workbook wires it in a later slice.
 */
export async function buildCpvUnitWorkbookSpec(): Promise<
  ImportSpec<WorkbookCpvUnitImportFile, CreateCpvUnitInput>
> {
  const maps = await loadCpvUnitMaps();

  const resolve = async (input: WorkbookCpvUnitImportFile): Promise<ResolveResult<CreateCpvUnitInput>> => {
    const errors: { column: string; message: string }[] = [];

    const { clientId, productId } = resolveClientAndProduct(
      input.clientCode,
      input.productCode,
      maps,
      errors,
    );

    let verificationUnitId: number | null | undefined;
    if (isUniversalUnitCode(input.unitCode)) {
      verificationUnitId = null;
    } else {
      verificationUnitId = maps.unitMap.get(input.unitCode!.trim());
      if (verificationUnitId === undefined)
        errors.push({ column: 'Unit Code', message: `unknown unit code ${input.unitCode}` });
    }

    const clientProductId = resolveLink(
      clientId,
      productId,
      input.clientCode,
      input.productCode,
      maps,
      errors,
    );

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        clientProductId: clientProductId!,
        verificationUnitId,
        ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      },
    };
  };

  return {
    resource: 'client_product_verification_units',
    columns: WORKBOOK_CPV_IMPORT_COLUMNS,
    schema: WorkbookCpvUnitImportFileSchema,
    sample: CPV_IMPORT_SAMPLE,
    resolve,
  };
}
