import type {
  BillingLineRow,
  BillingLinesSummary,
  CommissionSummaryRow,
  CommissionDetailRow,
  CommissionPeriod,
  CommissionGroupBy,
  Paginated,
} from '@crm2/sdk';
import {
  billingRepository as repo,
  COMPLETED_BAND,
  type CommissionSummaryOptions,
  type CommissionDetailOptions,
} from './repository.js';
import type { Scope } from '../../platform/scope/index.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';

/** The standard ACS SLA TAT bands (the `tat_policies` seed: 4/6/8/12/24/48h) + `-1` = out-of-band, as the
 *  TAT-band filter's allowed values. The picker is a convenience over the derived band; filtering matches the
 *  numeric band exactly. If admins add non-standard bands, extend this list. */
const TAT_BAND_FILTER_VALUES = ['4', '6', '8', '12', '24', '48', '-1'];

/** Flat billing-lines grid columns (ADR-0086). Sort targets are real columns or the `tat_band`/`bill_total`
 *  SELECT aliases (valid ORDER BY targets in PG). Filters land in the WHERE on real columns (rt/l are in the
 *  FROM); `tatBand` filters on the derived-band expression. `location` is display-only (search covers pincode/area). */
const BILLING_LINES_SPEC: PageSpec = {
  sortMap: {
    caseNumber: 'cs.case_number',
    client: 'cl.name',
    product: 'p.name',
    unit: 'vu.name',
    assignee: 'au.name',
    rateType: 'rt.client_rate_type',
    tatBand: 'tat_band',
    billCount: 'ct.bill_count',
    billTotal: 'bill_total',
    completedAt: 'ct.completed_at',
  },
  filterMap: {
    client: { column: 'cl.name', kind: 'text' },
    product: { column: 'p.name', kind: 'text' },
    unit: { column: 'vu.name', kind: 'text' },
    rateType: { column: 'rt.client_rate_type', kind: 'text' },
    tatBand: { column: `(${COMPLETED_BAND})::text`, kind: 'enum', values: TAT_BAND_FILTER_VALUES },
    pincode: { column: 'l.pincode', kind: 'text' },
    area: { column: 'l.area', kind: 'text' },
    caseNumber: { column: 'cs.case_number', kind: 'text' },
    completedAt: { column: 'ct.completed_at', kind: 'date' },
  },
  defaultSort: 'completedAt',
  defaultOrder: 'desc',
};

const toPosInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const asStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Commission-summary period/grain whitelists (ADR-0081) — unknown values fall back to the defaults
 *  (lenient, like the rest of this service; the SDK only ever sends valid values). */
const VALID_PERIODS: readonly CommissionPeriod[] = ['week', 'fortnight', 'month', 'quarter'];
const VALID_GROUP_BY: readonly CommissionGroupBy[] = [
  'agent',
  'agentClientProduct',
  'agentClientProductRateType',
];
const resolvePeriod = (v: unknown): CommissionPeriod =>
  typeof v === 'string' && (VALID_PERIODS as readonly string[]).includes(v)
    ? (v as CommissionPeriod)
    : 'month';
const resolveGroupBy = (v: unknown): CommissionGroupBy =>
  typeof v === 'string' && (VALID_GROUP_BY as readonly string[]).includes(v)
    ? (v as CommissionGroupBy)
    : 'agent';

/** Fixed-sort summary spec — the repo orders by period DESC then agent; resolvePage gives page/limit only. */
const COMMISSION_SUMMARY_PAGE_SPEC: PageSpec = {
  sortMap: { periodStart: 'period_start', commissionTotal: 'commission_total', agent: 'agent_name' },
  defaultSort: 'periodStart',
  defaultOrder: 'desc',
};

/** Fixed-sort detail spec — the repo orders by earned-at DESC then task; resolvePage gives page/limit only. */
const COMMISSION_DETAIL_PAGE_SPEC: PageSpec = {
  sortMap: { earnedOn: 'earned_on', agent: 'agent_name' },
  defaultSort: 'earnedOn',
  defaultOrder: 'desc',
};

const COMMISSION_SUMMARY_EXPORT_COLUMNS: ExportColumn<CommissionSummaryRow>[] = [
  { id: 'agent', header: 'Agent', value: (r) => r.agentName },
  { id: 'client', header: 'Client', value: (r) => r.clientName ?? '' },
  { id: 'product', header: 'Product', value: (r) => r.productName ?? '' },
  { id: 'clientRateType', header: 'Client Rate Type', value: (r) => r.clientRateType ?? '' },
  { id: 'fieldRateType', header: 'Field Rate Type', value: (r) => r.fieldRateType ?? '' },
  { id: 'period', header: 'Period', value: (r) => r.periodKey },
  { id: 'periodStart', header: 'Period Start', value: (r) => r.periodStart },
  { id: 'tasks', header: 'Tasks', value: (r) => r.taskCount },
  { id: 'billableUnits', header: 'Billable Units', value: (r) => r.billableUnits },
  { id: 'billTotal', header: 'Bill Total', value: (r) => r.billTotal },
  { id: 'commissionTotal', header: 'Commission Total', value: (r) => r.commissionTotal },
];

/** Per-task commission/billing detail export (v1 line-export parity). */
const COMMISSION_DETAIL_EXPORT_COLUMNS: ExportColumn<CommissionDetailRow>[] = [
  { id: 'earnedOn', header: 'Earned On', value: (r) => r.earnedOn },
  { id: 'agent', header: 'Agent', value: (r) => r.agentName },
  { id: 'client', header: 'Client', value: (r) => r.clientName },
  { id: 'product', header: 'Product', value: (r) => r.productName },
  { id: 'unit', header: 'Verification Unit', value: (r) => r.unitName },
  { id: 'case', header: 'Case', value: (r) => r.caseNumber },
  { id: 'task', header: 'Task', value: (r) => r.taskNumber },
  { id: 'visitType', header: 'Visit Type', value: (r) => r.visitType ?? '' },
  { id: 'clientRateType', header: 'Client Rate Type', value: (r) => r.clientRateType ?? '' },
  { id: 'fieldRateType', header: 'Field Rate Type', value: (r) => r.fieldRateType ?? '' },
  { id: 'billAmount', header: 'Client Bill (rate)', value: (r) => r.billAmount },
  { id: 'commissionAmount', header: 'Commission', value: (r) => r.commissionAmount },
  { id: 'billCount', header: 'Bill Count', value: (r) => r.billCount },
  { id: 'status', header: 'Status', value: (r) => r.status },
];

const bandLabel = (b: number | null): string => (b == null ? '' : b === -1 ? 'Out of band' : `≤${b}h`);

const BILLING_LINES_EXPORT_COLUMNS: ExportColumn<BillingLineRow>[] = [
  { id: 'caseNumber', header: 'Case', value: (r) => r.caseNumber },
  { id: 'client', header: 'Client', value: (r) => r.clientName },
  { id: 'product', header: 'Product', value: (r) => r.productName },
  { id: 'unit', header: 'Verification Unit', value: (r) => r.unitName },
  { id: 'assignee', header: 'Assignee', value: (r) => r.assigneeName ?? '' },
  { id: 'rateType', header: 'Rate Type', value: (r) => r.clientRateType ?? '' },
  { id: 'tatBand', header: 'TAT Band', value: (r) => bandLabel(r.tatBand) },
  { id: 'pincode', header: 'Pincode', value: (r) => r.pincode ?? '' },
  { id: 'area', header: 'Area', value: (r) => r.area ?? '' },
  { id: 'billCount', header: 'Units', value: (r) => r.billCount },
  { id: 'billTotal', header: 'Bill', value: (r) => r.billTotal },
  { id: 'completedAt', header: 'Completed', value: (r) => r.completedAt },
];

/** Resolve the commission-summary repo options from the raw query + scope + resolved pagination. */
function buildSummaryOpts(
  rawQuery: Record<string, unknown>,
  scope: Scope,
  search: string | undefined,
  limit: number,
  offset: number,
): CommissionSummaryOptions {
  const clientId = toPosInt(rawQuery['clientId']);
  const productId = toPosInt(rawQuery['productId']);
  const from = asStr(rawQuery['from']);
  const to = asStr(rawQuery['to']);
  return {
    scope,
    period: resolvePeriod(rawQuery['period']),
    groupBy: resolveGroupBy(rawQuery['groupBy']),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(productId !== undefined ? { productId } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(search !== undefined ? { search } : {}),
    limit,
    offset,
  };
}

/** Resolve the commission-detail repo options from the raw query + scope + resolved pagination. */
function buildDetailOpts(
  rawQuery: Record<string, unknown>,
  scope: Scope,
  search: string | undefined,
  limit: number,
  offset: number,
): CommissionDetailOptions {
  const clientId = toPosInt(rawQuery['clientId']);
  const productId = toPosInt(rawQuery['productId']);
  const from = asStr(rawQuery['from']);
  const to = asStr(rawQuery['to']);
  return {
    scope,
    ...(clientId !== undefined ? { clientId } : {}),
    ...(productId !== undefined ? { productId } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(search !== undefined ? { search } : {}),
    limit,
    offset,
  };
}

/**
 * Billing + Commission service (ADR-0036; separated + redesigned by ADR-0086) — two read-models behind one
 * module: the flat BILLING lines read-model (one row per COMPLETED billable task, `billing.view`) and the
 * periodic COMMISSION read-model (agent commission summary/detail, `commission_summary.view`). Read-only,
 * DERIVED at read time; no billed-state persisted.
 */
export const billingService = {
  async listLines(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<BillingLineRow>> {
    const r = resolvePage(rawQuery, BILLING_LINES_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_LINES_SPEC);
    const { items, totalCount } = await repo.listLines({
      scope,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(completedFrom !== undefined ? { completedFrom } : {}),
      ...(completedTo !== undefined ? { completedTo } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (completedFrom !== undefined) filters['completedFrom'] = completedFrom;
    if (completedTo !== undefined) filters['completedTo'] = completedTo;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport, actor: Actor) {
    const r = resolvePage(rawQuery, BILLING_LINES_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_LINES_SPEC);
    const selectedIds = ex.mode === 'selected' ? ex.ids.filter((s) => typeof s === 'string') : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: BILLING_LINES_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.listLines({
      scope,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(completedFrom !== undefined ? { completedFrom } : {}),
      ...(completedTo !== undefined ? { completedTo } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: BILLING_LINES_EXPORT_COLUMNS };
  },

  /** Filter-aware ₹ bill total + line count over ALL matching lines (the flat grid's footer, ADR-0086). Same
   *  filter contract as `listLines` (clientId, completedFrom/To, search, column filters). */
  async linesSummary(rawQuery: Record<string, unknown>, actor: Actor): Promise<BillingLinesSummary> {
    const r = resolvePage(rawQuery, BILLING_LINES_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_LINES_SPEC);
    return repo.linesSummary({
      scope,
      ...(clientId !== undefined ? { clientId } : {}),
      ...(completedFrom !== undefined ? { completedFrom } : {}),
      ...(completedTo !== undefined ? { completedTo } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
    });
  },

  /**
   * Periodic per-field-user commission rollup (ADR-0081) — week/fortnight/month/quarter buckets, optionally
   * split by client+product. Read-only; gated `commission_summary.view` (ADR-0086). Anchored on earned-at (ADR-0047 freeze).
   */
  async commissionSummary(
    rawQuery: Record<string, unknown>,
    actor: Actor,
  ): Promise<Paginated<CommissionSummaryRow>> {
    const r = resolvePage(rawQuery, COMMISSION_SUMMARY_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const { items, totalCount } = await repo.commissionSummary(
      buildSummaryOpts(rawQuery, scope, r.search, r.limit, r.offset),
    );
    const filters: Record<string, unknown> = {
      period: resolvePeriod(rawQuery['period']),
      groupBy: resolveGroupBy(rawQuery['groupBy']),
    };
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const from = asStr(rawQuery['from']);
    const to = asStr(rawQuery['to']);
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (productId !== undefined) filters['productId'] = productId;
    if (from !== undefined) filters['from'] = from;
    if (to !== undefined) filters['to'] = to;
    if (r.search !== undefined) filters['search'] = r.search;
    return buildPage(items, totalCount, r, filters);
  },

  /** Export the commission summary (same query + format/mode → rows + columns for the export writer). */
  async exportCommissionSummary(rawQuery: Record<string, unknown>, ex: ResolvedExport, actor: Actor) {
    const r = resolvePage(rawQuery, COMMISSION_SUMMARY_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const opts = buildSummaryOpts(
      rawQuery,
      scope,
      r.search,
      ex.mode === 'current' ? r.limit : exportThreshold(),
      ex.mode === 'current' ? r.offset : 0,
    );
    const { items, totalCount } = await repo.commissionSummary(opts);
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: COMMISSION_SUMMARY_EXPORT_COLUMNS };
  },

  /**
   * Per-task commission/billing DETAIL (ADR-0081, v1 line-export parity) — one row per commissioned task with
   * both rate types + the real client bill rate + commission. Read-only; gated `commission_summary.view` (ADR-0086).
   */
  async commissionDetail(
    rawQuery: Record<string, unknown>,
    actor: Actor,
  ): Promise<Paginated<CommissionDetailRow>> {
    const r = resolvePage(rawQuery, COMMISSION_DETAIL_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const { items, totalCount } = await repo.commissionDetail(
      buildDetailOpts(rawQuery, scope, r.search, r.limit, r.offset),
    );
    const filters: Record<string, unknown> = {};
    const clientId = toPosInt(rawQuery['clientId']);
    const productId = toPosInt(rawQuery['productId']);
    const from = asStr(rawQuery['from']);
    const to = asStr(rawQuery['to']);
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (productId !== undefined) filters['productId'] = productId;
    if (from !== undefined) filters['from'] = from;
    if (to !== undefined) filters['to'] = to;
    if (r.search !== undefined) filters['search'] = r.search;
    return buildPage(items, totalCount, r, filters);
  },

  /** Export the commission detail (same query + format/mode → rows + columns for the export writer). */
  async exportCommissionDetail(rawQuery: Record<string, unknown>, ex: ResolvedExport, actor: Actor) {
    const r = resolvePage(rawQuery, COMMISSION_DETAIL_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const opts = buildDetailOpts(
      rawQuery,
      scope,
      r.search,
      ex.mode === 'current' ? r.limit : exportThreshold(),
      ex.mode === 'current' ? r.offset : 0,
    );
    const { items, totalCount } = await repo.commissionDetail(opts);
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: COMMISSION_DETAIL_EXPORT_COLUMNS };
  },
};
