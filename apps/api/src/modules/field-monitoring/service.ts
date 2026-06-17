import type { FieldAgentView, FieldMonitoringStats, Paginated, RequestLocationResult } from '@crm2/sdk';
import { fieldMonitoringRepository as repo } from './repository.js';
import { notificationService } from '../notifications/service.js';
import { resolvePage, buildPage, type PageSpec } from '../../platform/pagination.js';
import { assertExportable, exportThreshold, type ResolvedExport } from '../../platform/export/index.js';
import type { ExportColumn } from '../../platform/export/index.js';
import { getScopedUserIds, type Actor } from '../../platform/scope/index.js';
import { AppError } from '../../platform/errors.js';

/** Sortable columns (apiField → SQL expression). Every column lives in the shared FM FROM. */
const FM_PAGE_SPEC: PageSpec = {
  sortMap: {
    name: 'u.name',
    username: 'u.username',
    openTasks: 't.open_tasks',
    completedToday: 't.completed_today',
    overdue: 't.overdue',
    lastActivityAt: 't.last_activity_at',
    createdAt: 'u.created_at',
    updatedAt: 'u.updated_at',
  },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

const FM_EXPORT_COLUMNS: ExportColumn<FieldAgentView>[] = [
  { id: 'name', header: 'Agent', value: (r) => r.name },
  { id: 'username', header: 'Username', value: (r) => r.username },
  { id: 'employeeId', header: 'Employee ID', value: (r) => r.employeeId ?? '' },
  { id: 'phone', header: 'Contact', value: (r) => r.phone ?? '' },
  { id: 'openTasks', header: 'Open', value: (r) => r.openTasks },
  { id: 'inProgress', header: 'In Progress', value: (r) => r.inProgress },
  { id: 'completedToday', header: 'Completed Today', value: (r) => r.completedToday },
  { id: 'overdue', header: 'Overdue', value: (r) => r.overdue },
  { id: 'territoryPincodes', header: 'Pincodes', value: (r) => r.territoryPincodes },
  { id: 'territoryAreas', header: 'Areas', value: (r) => r.territoryAreas },
  { id: 'lastActivityAt', header: 'Last Activity', value: (r) => r.lastActivityAt ?? '' },
  { id: 'lastLocationAt', header: 'Last Location At', value: (r) => r.lastLocationAt ?? '' },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'updatedAt', header: 'Updated', value: (r) => r.updatedAt },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Aging window: open work an agent has held longer than this is "overdue".
const OVERDUE_WINDOW_HOURS = 24;
const MS_PER_HOUR = 3_600_000;
// IST = UTC+05:30 — "today" + the console's day boundary are IST (the field operates in India).
const IST_OFFSET_MS = 19_800_000;

/** The completed-today + overdue time windows (IST day boundary), as ISO strings for the query. */
function windows(): { startOfToday: string; overdueCutoff: string } {
  const now = Date.now();
  const overdueCutoff = new Date(now - OVERDUE_WINDOW_HOURS * MS_PER_HOUR).toISOString();
  const ist = new Date(now + IST_OFFSET_MS);
  const istMidnightUtcMs =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  return { startOfToday: new Date(istMidnightUtcMs).toISOString(), overdueCutoff };
}

/**
 * Field Monitoring service (ADR-0026). The roster is the FIELD visit-pool population, filtered to
 * the actor's hierarchy scope (getScopedUserIds — a TL sees only their team). Truthful data only:
 * workload / throughput / aging / last-activity from case_tasks; last-known GPS null until ingest.
 */
export const fieldMonitoringService = {
  async list(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<FieldAgentView>> {
    const r = resolvePage(rawQuery, FM_PAGE_SPEC);
    const scopeUserIds = await getScopedUserIds(actor);
    const w = windows();
    const { items, totalCount } = await repo.list({
      ...(scopeUserIds !== undefined ? { scopeUserIds } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      startOfToday: w.startOfToday,
      overdueCutoff: w.overdueCutoff,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (r.search !== undefined) filters['search'] = r.search;
    return buildPage(items, totalCount, r, filters);
  },

  async stats(rawQuery: Record<string, unknown>, actor: Actor): Promise<FieldMonitoringStats> {
    const r = resolvePage(rawQuery, FM_PAGE_SPEC);
    const scopeUserIds = await getScopedUserIds(actor);
    const w = windows();
    return repo.stats({
      ...(scopeUserIds !== undefined ? { scopeUserIds } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      startOfToday: w.startOfToday,
      overdueCutoff: w.overdueCutoff,
    });
  },

  async exportData(rawQuery: Record<string, unknown>, ex: ResolvedExport, actor: Actor) {
    const r = resolvePage(rawQuery, FM_PAGE_SPEC);
    const selectedIds = ex.mode === 'selected' ? ex.ids.filter((id) => UUID_RE.test(id)) : undefined;
    if (ex.mode === 'selected' && (!selectedIds || selectedIds.length === 0))
      return { rows: [], columns: FM_EXPORT_COLUMNS };
    const scopeUserIds = await getScopedUserIds(actor);
    const w = windows();
    const { items, totalCount } = await repo.list({
      ...(scopeUserIds !== undefined ? { scopeUserIds } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      startOfToday: w.startOfToday,
      overdueCutoff: w.overdueCutoff,
      ...(selectedIds ? { ids: selectedIds } : {}),
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: FM_EXPORT_COLUMNS };
  },

  /**
   * Admin "request location" ping (ADR-0027): wake a field agent for a fresh fix. Scope-guarded — the
   * target must be inside the supervisor's monitoring scope, else 404 (IDOR-safe, mirrors the roster).
   * Delegates the FCM + socket delivery to the notification service.
   */
  async requestLocation(actor: Actor, targetUserId: string): Promise<RequestLocationResult> {
    if (!UUID_RE.test(targetUserId)) throw AppError.notFound();
    const scoped = await getScopedUserIds(actor);
    if (scoped !== undefined && !scoped.includes(targetUserId)) throw AppError.notFound();
    return notificationService.requestDeviceLocation(targetUserId, actor.userId);
  },
};
