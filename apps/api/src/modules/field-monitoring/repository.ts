import type { FieldAgentView, FieldMonitoringStats, SortOrder } from '@crm2/sdk';
import { query } from '../../platform/db.js';
import { taskScopePredicate, type Scope } from '../../platform/scope/index.js';
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
const OPEN_STATUSES = "('PENDING','ASSIGNED','IN_PROGRESS','SUBMITTED')";
// 'open & overdue' excludes PENDING (an unassigned task has no agent to be late) — only work the
// agent already holds counts toward their aging.
const OVERDUE_STATUSES = "('ASSIGNED','IN_PROGRESS','SUBMITTED')";

/**
 * Per-agent workload aggregate. TWO different scope legs apply to this page and they are NOT the same
 * question:
 *  - WHICH AGENTS appear (the roster) = the hierarchy leg, applied in `buildWhere` on `u.id`.
 *  - WHICH TASKS COUNT toward each agent = the full task-grain predicate, applied HERE.
 *
 * Audit 2026-07-14: only the first existed, so the counts were computed over EVERY client and product.
 * A TEAM_LEADER capped to one client (and holding page.field_monitoring) saw each report's
 * open/in-progress/completed-today/overdue/aging computed across work they cannot open — and the tiles
 * disagreed with Pipeline ("Agent X: 40 open" vs 5 rows). Sharpest for a leader with ZERO client grants:
 * fail-closed everywhere else, yet non-zero counts here.
 *
 * `cases cs` is joined because every dimension leg is expressed over the case (`cs.client_id` etc.).
 * `$1`/`$2` are the caller's fixed window params; `scopePred` allocates from `$3` up.
 */
const taskAgg = (scopePred: string): string => `
  LEFT JOIN (
    SELECT ct.assigned_to AS user_id,
      count(*) FILTER (WHERE ct.status IN ${OPEN_STATUSES}) AS open_tasks,
      count(*) FILTER (WHERE ct.status = 'IN_PROGRESS') AS in_progress,
      count(*) FILTER (WHERE ct.status = 'COMPLETED' AND ct.completed_at >= $1) AS completed_today,
      count(*) FILTER (WHERE ct.status IN ${OVERDUE_STATUSES} AND ct.assigned_at < $2) AS overdue,
      min(ct.assigned_at) FILTER (WHERE ct.status IN ${OPEN_STATUSES}) AS oldest_open_assigned_at,
      max(GREATEST(ct.assigned_at, ct.completed_at, ct.updated_at)) AS last_activity_at
    FROM case_tasks ct
    JOIN cases cs ON cs.id = ct.case_id
    WHERE ct.assigned_to IS NOT NULL${scopePred ? `\n      AND (${scopePred})` : ''}
    GROUP BY ct.assigned_to
  ) t ON t.user_id = u.id`;

const TERRITORY_AGG = `
  LEFT JOIN (
    SELECT user_id,
      count(*) FILTER (WHERE dimension_code = 'PINCODE') AS territory_pincodes,
      count(*) FILTER (WHERE dimension_code = 'AREA') AS territory_areas
    FROM user_scope_assignments WHERE is_active GROUP BY user_id
  ) terr ON terr.user_id = u.id`;

const fmFrom = (scopePred: string): string => `
  FROM users u
  ${taskAgg(scopePred)}
  ${TERRITORY_AGG}
  LEFT JOIN latest_device_location ll ON ll.user_id = u.id`;

const fmSelect = (scopePred: string): string => `
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
  ${fmFrom(scopePred)}`;

export interface AgentListOptions {
  /**
   * The actor's FULL resolved scope. `scope.userIds` (hierarchy) filters the ROSTER — which agents are
   * listed; the dimension legs cap the per-agent COUNTS (see `taskAgg`). An empty scope `{}` =
   * SUPER_ADMIN / hierarchy ALL = no filter on either.
   */
  scope: Scope;
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

/** Shared WHERE: the FIELD visit-pool role (data-driven, no role literal) + the ROSTER (hierarchy) +
 *  search. The dimension legs are NOT applied here — they cap the per-agent counts, not the roster. */
function buildWhere(o: Pick<AgentListOptions, 'scope' | 'search' | 'ids'>, params: unknown[]): string {
  const where: string[] = [
    `u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = 'FIELD')`,
  ];
  if (o.scope.userIds !== undefined) {
    params.push(o.scope.userIds);
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
    // Order is load-bearing: taskAgg's SQL sits in the FROM and reads $1/$2, so the dimension legs must
    // allocate next (from $3) — BEFORE buildWhere pushes the roster/search binds.
    const scopePred = taskScopePredicate(params, o.scope);
    const clause = buildWhere(o, params);
    // COUNT counts AGENTS (the roster), so it needs neither the $1/$2 window nor the dimension legs —
    // the counts the predicate caps live inside taskAgg, which a bare users count doesn't join.
    const countParams: unknown[] = [];
    const countClause = buildWhere(o, countParams);
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users u ${countClause}`,
      countParams,
    );
    const totalCount = countRow?.count ?? 0;
    const items = await query<FieldAgentView>(
      `${fmSelect(scopePred)} ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, u.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async stats(
    o: Pick<AgentListOptions, 'scope' | 'search' | 'startOfToday' | 'overdueCutoff'>,
  ): Promise<FieldMonitoringStats> {
    const params: unknown[] = [o.startOfToday, o.overdueCutoff];
    const scopePred = taskScopePredicate(params, o.scope);
    const clause = buildWhere(o, params);
    const [row] = await query<FieldMonitoringStats>(
      `SELECT count(*)::int AS agents,
              count(*) FILTER (WHERE COALESCE(t.open_tasks, 0) > 0)::int AS with_open_work,
              COALESCE(sum(t.open_tasks), 0)::int AS open_tasks,
              COALESCE(sum(t.completed_today), 0)::int AS completed_today,
              COALESCE(sum(t.overdue), 0)::int AS overdue
       FROM users u ${taskAgg(scopePred)} ${clause}`,
      params,
    );
    return row ?? { agents: 0, withOpenWork: 0, openTasks: 0, completedToday: 0, overdue: 0 };
  },
};
