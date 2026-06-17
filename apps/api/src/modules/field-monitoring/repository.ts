import type { FieldAgentView, FieldMonitoringStats, SortOrder } from '@crm2/sdk';
import { query } from '../../platform/db.js';
import { likeContains } from '../../platform/pagination.js';

/**
 * Field Monitoring repository (ADR-0026) — one row per field executive in the supervisor's
 * hierarchy scope. USER-grain (not task-grain): the population is the FIELD visit-pool role,
 * filtered to `scopeUserIds` (resolved by getScopedUserIds: SA=all, MGR=subtree, TL=team).
 * Per-agent aggregates from case_tasks; territory from user_scope_assignments; last-known GPS
 * from latest_device_location (null until the device rebases onto /api/v2 — forward-prep).
 *
 * Param contract: $1 = start-of-today (completed-today window), $2 = overdue cutoff. These feed
 * the aggregate JOIN (which appears in the SQL before the WHERE), so the list/stats callers push
 * them FIRST; `buildWhere` appends scope/search/role params after.
 */
const OPEN_STATUSES = "('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED_FOR_REVIEW')";
// 'open & overdue' excludes PENDING (an unassigned task has no agent to be late) — only work the
// agent already holds counts toward their aging.
const OVERDUE_STATUSES = "('ASSIGNED','IN_PROGRESS','SUBMITTED_FOR_REVIEW')";

const TASK_AGG = `
  LEFT JOIN (
    SELECT ct.assigned_to AS user_id,
      count(*) FILTER (WHERE ct.status IN ${OPEN_STATUSES}) AS open_tasks,
      count(*) FILTER (WHERE ct.status = 'IN_PROGRESS') AS in_progress,
      count(*) FILTER (WHERE ct.status = 'COMPLETED' AND ct.completed_at >= $1) AS completed_today,
      count(*) FILTER (WHERE ct.status IN ${OVERDUE_STATUSES} AND ct.assigned_at < $2) AS overdue,
      min(ct.assigned_at) FILTER (WHERE ct.status IN ${OPEN_STATUSES}) AS oldest_open_assigned_at,
      max(GREATEST(ct.assigned_at, ct.completed_at, ct.updated_at)) AS last_activity_at
    FROM case_tasks ct
    WHERE ct.assigned_to IS NOT NULL
    GROUP BY ct.assigned_to
  ) t ON t.user_id = u.id`;

const TERRITORY_AGG = `
  LEFT JOIN (
    SELECT user_id,
      count(*) FILTER (WHERE dimension_code = 'PINCODE') AS territory_pincodes,
      count(*) FILTER (WHERE dimension_code = 'AREA') AS territory_areas
    FROM user_scope_assignments WHERE is_active GROUP BY user_id
  ) terr ON terr.user_id = u.id`;

const FM_FROM = `
  FROM users u
  ${TASK_AGG}
  ${TERRITORY_AGG}
  LEFT JOIN latest_device_location ll ON ll.user_id = u.id`;

const FM_SELECT = `
  SELECT u.id, u.name, u.username, u.employee_id, u.phone, u.is_active,
         u.created_at, u.updated_at,
         COALESCE(t.open_tasks, 0)::int AS open_tasks,
         COALESCE(t.in_progress, 0)::int AS in_progress,
         COALESCE(t.completed_today, 0)::int AS completed_today,
         COALESCE(t.overdue, 0)::int AS overdue,
         t.oldest_open_assigned_at, t.last_activity_at,
         COALESCE(terr.territory_pincodes, 0)::int AS territory_pincodes,
         COALESCE(terr.territory_areas, 0)::int AS territory_areas,
         ll.latitude::float8 AS last_lat, ll.longitude::float8 AS last_lng,
         ll.recorded_at AS last_location_at, ll.source AS last_location_source
  ${FM_FROM}`;

export interface AgentListOptions {
  /** hierarchy-scoped user ids; undefined = no filter (SUPER_ADMIN). */
  scopeUserIds?: string[];
  search?: string;
  /** start-of-today (ISO) for the completed-today window. */
  startOfToday: string;
  /** overdue cutoff (ISO) — open work assigned before this is "overdue". */
  overdueCutoff: string;
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
  ids?: string[];
}

/** Shared WHERE: the FIELD visit-pool role (data-driven, no role literal) + scope + search. */
function buildWhere(o: Pick<AgentListOptions, 'scopeUserIds' | 'search' | 'ids'>, params: unknown[]): string {
  const where: string[] = [
    `u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = 'FIELD')`,
  ];
  if (o.scopeUserIds !== undefined) {
    params.push(o.scopeUserIds);
    where.push(`u.id = ANY($${params.length}::uuid[])`);
  }
  if (o.search) {
    params.push(likeContains(o.search));
    where.push(
      `(u.name ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.phone ILIKE $${params.length})`,
    );
  }
  if (o.ids) {
    params.push(o.ids);
    where.push(`u.id = ANY($${params.length}::uuid[])`);
  }
  return `WHERE ${where.join(' AND ')}`;
}

export const fieldMonitoringRepository = {
  async list(o: AgentListOptions): Promise<{ items: FieldAgentView[]; totalCount: number }> {
    const params: unknown[] = [o.startOfToday, o.overdueCutoff];
    const clause = buildWhere(o, params);
    // COUNT: own param set (the aggregate-window params $1/$2 aren't referenced in a bare users count).
    const countParams: unknown[] = [];
    const countClause = buildWhere(o, countParams);
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users u ${countClause}`,
      countParams,
    );
    const totalCount = countRow?.count ?? 0;
    const items = await query<FieldAgentView>(
      `${FM_SELECT} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, u.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async stats(
    o: Pick<AgentListOptions, 'scopeUserIds' | 'search' | 'startOfToday' | 'overdueCutoff'>,
  ): Promise<FieldMonitoringStats> {
    const params: unknown[] = [o.startOfToday, o.overdueCutoff];
    const clause = buildWhere(o, params);
    const [row] = await query<FieldMonitoringStats>(
      `SELECT count(*)::int AS agents,
              count(*) FILTER (WHERE COALESCE(t.open_tasks, 0) > 0)::int AS with_open_work,
              COALESCE(sum(t.open_tasks), 0)::int AS open_tasks,
              COALESCE(sum(t.completed_today), 0)::int AS completed_today,
              COALESCE(sum(t.overdue), 0)::int AS overdue
       FROM users u ${TASK_AGG} ${clause}`,
      params,
    );
    return row ?? { agents: 0, withOpenWork: 0, openTasks: 0, completedToday: 0, overdue: 0 };
  },
};
