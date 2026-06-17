import type { BillingCaseRow, BillingTaskLine, Paginated } from '@crm2/sdk';
import { billingRepository as repo } from './repository.js';
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
};
