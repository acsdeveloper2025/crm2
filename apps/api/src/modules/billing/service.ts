import type {
  BillingCaseRow,
  BillingTaskLine,
  BillingBreakdown,
  CommissionSummaryRow,
  CommissionDetailRow,
  CommissionPeriod,
  CommissionGroupBy,
  Paginated,
} from '@crm2/sdk';
import {
  billingRepository as repo,
  type CommissionSummaryOptions,
  type CommissionDetailOptions,
} from './repository.js';
import type { Scope } from '../../platform/scope/index.js';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';

/** Sortable/filterable columns. Aggregate aliases (bill_total, …) are valid ORDER BY targets in PG;
 *  filters land in the pre-aggregation WHERE (ct.completed_at / cl.name), so they're safe. */
const BILLING_PAGE_SPEC: PageSpec = {
  sortMap: {
    caseNumber: 'cs.case_number',
    client: 'cl.name',
    product: 'p.name',
    status: 'cs.status',
    completedTaskCount: 'completed_task_count',
    billTotal: 'bill_total',
    commissionTotal: 'commission_total',
    lastCompletedAt: 'last_completed_at',
  },
  filterMap: {
    client: { column: 'cl.name', kind: 'text' },
    caseNumber: { column: 'cs.case_number', kind: 'text' },
    completedAt: { column: 'ct.completed_at', kind: 'date' },
  },
  defaultSort: 'lastCompletedAt',
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

const BILLING_EXPORT_COLUMNS: ExportColumn<BillingCaseRow>[] = [
  { id: 'caseNumber', header: 'Case', value: (r) => r.caseNumber },
  { id: 'client', header: 'Client', value: (r) => r.clientName },
  { id: 'product', header: 'Product', value: (r) => r.productName },
  { id: 'status', header: 'Status', value: (r) => r.status.replace(/_/g, ' ') },
  { id: 'completedTaskCount', header: 'Completed Tasks', value: (r) => r.completedTaskCount },
  { id: 'billTotal', header: 'Bill Total', value: (r) => r.billTotal },
  { id: 'commissionTotal', header: 'Commission Total', value: (r) => r.commissionTotal },
  { id: 'lastCompletedAt', header: 'Last Completed', value: (r) => r.lastCompletedAt },
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
 * Billing & Commission service (ADR-0036) — the per-case money read-model. Read-only: bill amount
 * from the rates engine, commission from commission_rates, both DERIVED at read time. No billed-state.
 */
export const billingService = {
  async listCases(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<BillingCaseRow>> {
    const r = resolvePage(rawQuery, BILLING_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_PAGE_SPEC);
    const { items, totalCount } = await repo.listCases({
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
    const r = resolvePage(rawQuery, BILLING_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_PAGE_SPEC);
    const selectedIds = ex.mode === 'selected' ? ex.ids.filter((s) => typeof s === 'string') : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: BILLING_EXPORT_COLUMNS };
    const { items, totalCount } = await repo.listCases({
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
    return { rows: items, columns: BILLING_EXPORT_COLUMNS };
  },

  /** Per-case completed-task billing lines (accordion detail). Out-of-scope/absent case → 404. */
  async caseTasks(caseId: string, actor: Actor): Promise<BillingTaskLine[]> {
    const scope = await resolveScope(actor);
    if (!(await repo.caseVisible(caseId, scope))) throw AppError.notFound('CASE_NOT_FOUND');
    return repo.caseTasks(caseId);
  },

  /**
   * Completed-task totals grouped by pincode/area + completed-in band (ADR-0046 §4.3), over the SAME
   * filter contract as `listCases` (clientId, completedFrom/To, search, column filters). Read-only.
   */
  async breakdown(rawQuery: Record<string, unknown>, actor: Actor): Promise<BillingBreakdown> {
    const r = resolvePage(rawQuery, BILLING_PAGE_SPEC);
    const scope = await resolveScope(actor);
    const clientId = toPosInt(rawQuery['clientId']);
    const completedFrom = asStr(rawQuery['completedFrom']);
    const completedTo = asStr(rawQuery['completedTo']);
    const columnFilters = resolveFilters(rawQuery, BILLING_PAGE_SPEC);
    return repo.breakdown({
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
   * split by client+product. Read-only; gated `billing.view`. Anchored on earned-at (ADR-0047 freeze).
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
   * both rate types + the real client bill rate + commission. Read-only; gated `billing.commission_summary.view`.
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
