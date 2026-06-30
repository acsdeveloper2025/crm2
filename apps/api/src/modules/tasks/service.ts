import {
  BulkAssignSchema,
  CASE_TASK_STATUSES,
  VISIT_TYPES,
  type AssignableUser,
  type BulkAssignResult,
  type BulkAssignRowStatus,
  type Paginated,
  type TaskStats,
  type TaskView,
} from '@crm2/sdk';
import { taskRepository as repo } from './repository.js';
import { caseRepository } from '../cases/repository.js';
import { notifyTaskAssigned } from '../notifications/service.js';
import { AppError } from '../../platform/errors.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import { assertExportable, exportThreshold, type ResolvedExport } from '../../platform/export/index.js';
import type { ExportColumn } from '../../platform/export/index.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

/** Sortable/filterable columns (apiField → SQL column). Every referenced column is in the shared
 *  TASK_FROM (all 1:1 joins), so the same map is safe for the COUNT and stats too. */
const TASK_PAGE_SPEC: PageSpec = {
  sortMap: {
    caseNumber: 'cs.case_number',
    taskNumber: 'ct.task_number',
    clientName: 'cl.name',
    primaryName: 'pa.name',
    unitName: 'vu.name',
    visitType: 'ct.visit_type',
    status: 'ct.status',
    assignedToName: 'au.name',
    assignedAt: 'ct.assigned_at',
    createdAt: 'ct.created_at',
    updatedAt: 'ct.updated_at',
    // Target-TAT due time (ADR-0044) — a fixed, param-free expression (refs only `ct`), so it's the
    // same injection-safe whitelist token any other sortMap value is. NULL when unassigned/no target.
    dueAt: `(ct.assigned_at + (ct.tat_hours * interval '1 hour'))`,
  },
  filterMap: {
    caseNumber: { column: 'cs.case_number', kind: 'text' },
    taskNumber: { column: 'ct.task_number', kind: 'text' },
    clientName: { column: 'cl.name', kind: 'text' },
    primaryName: { column: 'pa.name', kind: 'text' },
    unitName: { column: 'vu.name', kind: 'text' },
    visitType: { column: 'ct.visit_type', kind: 'enum', values: VISIT_TYPES },
    status: { column: 'ct.status', kind: 'enum', values: CASE_TASK_STATUSES },
    assignedToName: { column: 'au.name', kind: 'text' },
    createdAt: { column: 'ct.created_at', kind: 'date' },
    assignedAt: { column: 'ct.assigned_at', kind: 'date' },
  },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/** Export manifest — ids match the Pipeline DataGrid column ids (B-13 contract). The ₹ amount
 *  columns carry restricted comp data → included ONLY for billing.view holders (the 5b money-export
 *  rule: an export carrying bill/commission must gate on the resource perm, not just data.export). */
function taskExportColumns(canViewBilling: boolean): ExportColumn<TaskView>[] {
  const cols: ExportColumn<TaskView>[] = [
    { id: 'caseNumber', header: 'Case', value: (r) => r.caseNumber },
    { id: 'taskNumber', header: 'Task', value: (r) => r.taskNumber },
    { id: 'clientName', header: 'Client', value: (r) => r.clientName },
    { id: 'primaryName', header: 'Applicant', value: (r) => r.primaryName },
    { id: 'unitName', header: 'Unit', value: (r) => `${r.unitCode} — ${r.unitName}` },
    { id: 'visitType', header: 'Visit Type', value: (r) => r.visitType ?? '' },
    { id: 'status', header: 'Status', value: (r) => r.status },
    { id: 'assignedToName', header: 'Assignee', value: (r) => r.assignedToName },
    { id: 'billCount', header: 'Bill Count', value: (r) => r.billCount },
  ];
  if (canViewBilling) {
    cols.push(
      { id: 'billAmount', header: 'Bill Amount', value: (r) => r.billAmount },
      { id: 'commissionAmount', header: 'Commission', value: (r) => r.commissionAmount },
    );
  }
  cols.push(
    { id: 'assignedAt', header: 'Assigned At', value: (r) => r.assignedAt },
    { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
    { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
  );
  return cols;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cap on the per-request assignable-users intersection (a bulk selection's pool lookup). */
const MAX_ASSIGNABLE_TASK_IDS = 100;

/** Validated toolbar/domain params shared by list, stats and export. */
function domainParams(rawQuery: Record<string, unknown>) {
  const statusRaw = rawQuery['status'];
  const status =
    typeof statusRaw === 'string' && (CASE_TASK_STATUSES as readonly string[]).includes(statusRaw)
      ? statusRaw
      : undefined;
  const clientIdRaw = Number(rawQuery['clientId']);
  const clientId = Number.isInteger(clientIdRaw) && clientIdRaw > 0 ? clientIdRaw : undefined;
  const productIdRaw = Number(rawQuery['productId']);
  const productId = Number.isInteger(productIdRaw) && productIdRaw > 0 ? productIdRaw : undefined;
  const unitIdRaw = Number(rawQuery['unitId']);
  const unitId = Number.isInteger(unitIdRaw) && unitIdRaw > 0 ? unitIdRaw : undefined;
  const assignedToRaw = rawQuery['assignedTo'];
  const assignedTo =
    typeof assignedToRaw === 'string' && UUID_RE.test(assignedToRaw) ? assignedToRaw : undefined;
  const overdue = rawQuery['overdue'] === '1' || rawQuery['overdue'] === 'true';
  const commissionable = rawQuery['commissionable'] === '1' || rawQuery['commissionable'] === 'true';
  return { status, clientId, productId, unitId, assignedTo, overdue, commissionable };
}

/**
 * Pipeline service — the operational task queue (design: docs/specs/2026-06-11-pipeline-design.md).
 * Every read resolves the actor's scope and composes the TASK-level predicate (ADR-0022): a task
 * is visible when (assigned within hierarchy OR case created within hierarchy OR an EXPAND
 * dimension matches) AND every RESTRICT dimension matches.
 */
export const taskService = {
  async list(
    rawQuery: Record<string, unknown>,
    actor: Actor,
    canViewBilling: boolean,
  ): Promise<Paginated<TaskView>> {
    const r = resolvePage(rawQuery, TASK_PAGE_SPEC);
    const d = domainParams(rawQuery);
    const columnFilters = resolveFilters(rawQuery, TASK_PAGE_SPEC);
    const scope = await resolveScope(actor);
    // No EXPLICIT sort = the caller didn't pass a whitelisted `sortBy` (the page default is in effect).
    // Lets the overdue filter apply its urgency ordering without ever overriding a user-chosen sort.
    const rawSortBy = rawQuery['sortBy'];
    const defaultSort = !(
      typeof rawSortBy === 'string' && Object.prototype.hasOwnProperty.call(TASK_PAGE_SPEC.sortMap, rawSortBy)
    );
    const { items, totalCount } = await repo.list({
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
      ...(d.productId !== undefined ? { productId: d.productId } : {}),
      ...(d.unitId !== undefined ? { unitId: d.unitId } : {}),
      ...(d.assignedTo !== undefined ? { assignedTo: d.assignedTo } : {}),
      ...(d.overdue ? { overdue: true, defaultSort } : {}),
      // commissionable is a billing.view-only filter; ignore it for actors who can't see amounts.
      ...(canViewBilling && d.commissionable ? { commissionable: true } : {}),
      ...(canViewBilling ? { billing: true } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      scope,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (d.status !== undefined) filters['status'] = d.status;
    if (d.clientId !== undefined) filters['clientId'] = d.clientId;
    if (d.productId !== undefined) filters['productId'] = d.productId;
    if (d.unitId !== undefined) filters['unitId'] = d.unitId;
    if (d.assignedTo !== undefined) filters['assignedTo'] = d.assignedTo;
    if (d.overdue) filters['overdue'] = '1';
    if (canViewBilling && d.commissionable) filters['commissionable'] = '1';
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  /** Bucket-bar counts: same scope + search + filters as the list, MINUS the `status` bucket param. */
  async stats(rawQuery: Record<string, unknown>, actor: Actor, canViewBilling: boolean): Promise<TaskStats> {
    const r = resolvePage(rawQuery, TASK_PAGE_SPEC);
    const d = domainParams(rawQuery);
    const columnFilters = resolveFilters(rawQuery, TASK_PAGE_SPEC);
    const scope = await resolveScope(actor);
    // The bucket counts (incl. REVOKED + the cross-status "Out of TAT") are computed server-side
    // over the same scope+search+column-filters, excluding the status/overdue bucket params. The
    // Commissionable bucket count is billing.view-gated (0 otherwise — comp data).
    return repo.stats({
      ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
      ...(d.productId !== undefined ? { productId: d.productId } : {}),
      ...(d.unitId !== undefined ? { unitId: d.unitId } : {}),
      ...(d.assignedTo !== undefined ? { assignedTo: d.assignedTo } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      ...(canViewBilling ? { billing: true } : {}),
      columnFilters,
      scope,
    });
  },

  /** Export (B-13): re-runs the SAME scoped list query. `selected` = ticked uuid ids only — an
   *  empty/invalid set exports nothing (never falls through to "all"). */
  async exportData(
    rawQuery: Record<string, unknown>,
    ex: ResolvedExport,
    actor: Actor,
    canViewBilling: boolean,
  ) {
    const columns = taskExportColumns(canViewBilling);
    const r = resolvePage(rawQuery, TASK_PAGE_SPEC);
    const d = domainParams(rawQuery);
    const columnFilters = resolveFilters(rawQuery, TASK_PAGE_SPEC);
    const selectedIds = ex.mode === 'selected' ? ex.ids.filter((id) => UUID_RE.test(id)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0)) return { rows: [], columns };
    const scope = await resolveScope(actor);
    const { items, totalCount } = await repo.list({
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.clientId !== undefined ? { clientId: d.clientId } : {}),
      ...(d.productId !== undefined ? { productId: d.productId } : {}),
      ...(d.unitId !== undefined ? { unitId: d.unitId } : {}),
      ...(d.assignedTo !== undefined ? { assignedTo: d.assignedTo } : {}),
      ...(canViewBilling && d.commissionable ? { commissionable: true } : {}),
      ...(canViewBilling ? { billing: true } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      scope,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns };
  },

  /** Executives eligible for EVERY task in `taskIds` (the bulk-assign pool — one assignee must fit
   *  all selected rows). All ids must be visible to the actor, else 404 (IDOR-safe). */
  async assignableUsers(rawTaskIds: unknown, actor: Actor, visitType = 'FIELD'): Promise<AssignableUser[]> {
    if (typeof rawTaskIds !== 'string' || rawTaskIds.trim() === '')
      throw AppError.badRequest('BAD_REQUEST', { param: 'taskIds' });
    const taskIds = [...new Set(rawTaskIds.split(',').map((s) => s.trim()))];
    if (taskIds.length > MAX_ASSIGNABLE_TASK_IDS)
      throw AppError.badRequest('TOO_MANY_TASKS', { max: MAX_ASSIGNABLE_TASK_IDS });
    if (!taskIds.every((id) => UUID_RE.test(id)))
      throw AppError.badRequest('BAD_REQUEST', { param: 'taskIds' });
    const scope = await resolveScope(actor);
    const visible = await repo.tasksForAssignment(taskIds, scope);
    if (visible.length !== taskIds.length) throw AppError.notFound('TASK_NOT_FOUND');
    return repo.eligibleAssignees(taskIds, visitType);
  },

  /**
   * Bulk assignment (design §4.4): per row — scope-visible? → status assignable? → assignee
   * eligible for THIS task? → OCC-guarded `caseRepository.assignTask` (the ONE write path, so
   * per-row audit + history ride free). A failed row is reported, never aborts the batch.
   */
  async bulkAssign(body: unknown, actor: Actor): Promise<BulkAssignResult> {
    const v = BulkAssignSchema.parse(body);
    const ids = v.items.map((i) => i.id);
    const scope = await resolveScope(actor);
    const visible = new Map((await repo.tasksForAssignment(ids, scope)).map((t) => [t.id, t] as const));
    const eligible = new Set(await repo.eligibleTaskIdsForAssignee(ids, v.assignedTo, v.visitType));
    // ADR-0056: field_rate_type is normally server-derived — caseRepository.assignTask derives it per task
    // from the assignee's commission at that task's location (NO_FIELD_COMMISSION if none). An explicit
    // value (rare; the web never sends one for bulk) is honored.
    const attrs = {
      assignedTo: v.assignedTo,
      visitType: v.visitType,
      fieldRateType: v.fieldRateType,
      billCount: v.billCount,
    };
    const results: BulkAssignResult['results'] = [];
    const counts: Record<BulkAssignRowStatus, number> = {
      OK: 0,
      CONFLICT: 0,
      NOT_FOUND: 0,
      NOT_ASSIGNABLE: 0,
      INELIGIBLE_ASSIGNEE: 0,
      NO_FIELD_COMMISSION: 0,
    };
    for (const item of v.items) {
      const row = visible.get(item.id);
      let status: BulkAssignRowStatus;
      if (!row) {
        status = 'NOT_FOUND'; // missing OR out-of-scope — indistinguishable (IDOR-safe)
      } else if (row.status !== 'PENDING') {
        // ADR-0055: bulk assigns only a PENDING task — same rule as single-assign (cases/service.ts).
        // A live ASSIGNED task is never re-pointed in place; the office Revokes (mandatory reason) then
        // reassigns the REVOKED task (reassign-after-revoke, ADR-0033), so every agent change is audited.
        status = 'NOT_ASSIGNABLE';
      } else if (!eligible.has(item.id)) {
        status = 'INELIGIBLE_ASSIGNEE';
      } else {
        try {
          const assigned = await caseRepository.assignTask(
            row.caseId,
            item.id,
            attrs,
            actor.userId,
            item.version,
          );
          status = 'OK';
          notifyTaskAssigned(assigned); // ADR-0027: bulk assign notifies each assignee too (parity with single assign)
        } catch (e) {
          if (e instanceof AppError && e.code === 'STALE_UPDATE') status = 'CONFLICT';
          // ADR-0056: a FIELD assignee with no commission at this task's location → per-row status.
          else if (e instanceof AppError && e.code === 'NO_FIELD_COMMISSION') status = 'NO_FIELD_COMMISSION';
          else throw e; // a real failure must not be swallowed as a per-row status
        }
      }
      counts[status] += 1;
      results.push({ id: item.id, status });
    }
    return {
      results,
      okCount: counts.OK,
      conflictCount: counts.CONFLICT,
      notFoundCount: counts.NOT_FOUND,
      notAssignableCount: counts.NOT_ASSIGNABLE,
      ineligibleCount: counts.INELIGIBLE_ASSIGNEE,
      noFieldCommissionCount: counts.NO_FIELD_COMMISSION,
    };
  },
};
