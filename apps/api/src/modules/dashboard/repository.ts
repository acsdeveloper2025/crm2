import type { DashboardStats, PortfolioRow } from '@crm2/sdk';
import { query } from '../../platform/db.js';
import {
  composeScopePredicate,
  resolveScope,
  taskScopePredicate,
  type Actor,
  type Scope,
} from '../../platform/scope/index.js';

/**
 * Dashboard repository (ADR-0029) — ONE scoped scan over the actor's visible tasks for the whole
 * overview. TASK-grain: FROM `case_tasks ct` JOIN `cases cs` (the contract `taskScopePredicate`
 * requires), so the scope leg matches the Pipeline's visibility exactly. All counts are FILTER
 * aggregates over that single scan (Postgres does them in one pass — cheap, no MV needed).
 *
 * Param contract (pushed FIRST, before scope): $1 = IST start-of-today, $2 = IST start-of-yesterday,
 * $3 = seven-days-ago. The scope predicate is appended AFTER and lands in the OUTER WHERE — never
 * inside a FILTER — so an out-of-scope row is never counted (SUPER_ADMIN / hierarchy-ALL → empty
 * predicate → no filter).
 */

/**
 * Out-of-TAT (overdue) predicate (ADR-0044) — kept local to respect module boundaries (mirrors the
 * Pipeline's OVERDUE_SQL). An OPEN task (PENDING/ASSIGNED/IN_PROGRESS) past its explicit per-task
 * target (`tat_hours`) since its clock start `assigned_at` (NOT created_at). No target / not yet
 * assigned ⇒ never overdue (fail-open). Pure SQL over `ct`.
 */
const OVERDUE_SQL = `(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
  AND ct.tat_hours IS NOT NULL AND ct.assigned_at IS NOT NULL
  AND now() > ct.assigned_at + (ct.tat_hours * interval '1 hour'))`;

/**
 * CASE-grain visibility predicate (mirrors the cases module's leg, kept local to respect module
 * boundaries): a case is visible when the actor created it OR an in-scope user holds one of its
 * tasks. `''` = no filter (SUPER_ADMIN / hierarchy ALL). FROM contract: `cases cs`.
 */
function caseScopePredicate(params: unknown[], scope: Scope): string {
  return composeScopePredicate(
    params,
    scope,
    (ph) =>
      `cs.created_by = ANY(${ph}) OR EXISTS (SELECT 1 FROM case_tasks ct WHERE ct.case_id = cs.id AND ct.assigned_to = ANY(${ph}))`,
    'CASE',
  );
}

export interface DashboardWindows {
  startOfToday: string;
  startOfYesterday: string;
  sevenDaysAgo: string;
}

const ZERO: DashboardStats = {
  bucket: 0,
  assigned: 0,
  inProgress: 0,
  awaitingCompletion: 0,
  completed: 0,
  revoked: 0,
  assignedToday: 0,
  completedToday: 0,
  completedYesterday: 0,
  completed7d: 0,
  overdue: 0,
  oldestUnassignedAt: null,
};

export const dashboardRepository = {
  /**
   * Is `role` the OFFICE assignment pool's role (KYC_VERIFIER today)? Data-driven from
   * `assignment_pool_roles` — no role literal. The office reviewer's dashboard is the OFFICE queue.
   */
  async isOfficePoolRole(role: string): Promise<boolean> {
    const [r] = await query<{ roleCode: string }>(
      `SELECT role_code FROM assignment_pool_roles WHERE visit_type = 'OFFICE'`,
    );
    return r?.roleCode === role;
  },

  /**
   * `officeOnly` narrows the scan to OFFICE-pool tasks — the office reviewer's queue (KYC_VERIFIER):
   * for that role the dashboard IS the office queue, not the cross-visit pipeline. Data-driven (the
   * caller resolves the office-pool role from `assignment_pool_roles`, no role literal here).
   */
  async stats(actor: Actor, w: DashboardWindows, officeOnly = false): Promise<DashboardStats> {
    const params: unknown[] = [w.startOfToday, w.startOfYesterday, w.sevenDaysAgo];
    const scope = await resolveScope(actor);
    const conds: string[] = [];
    const predicate = taskScopePredicate(params, scope);
    if (predicate) conds.push(predicate);
    if (officeOnly) conds.push(`ct.visit_type = 'OFFICE'`);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [row] = await query<Omit<DashboardStats, 'awaitingCompletion'>>(
      `SELECT
         count(*) FILTER (WHERE ct.status = 'PENDING')::int               AS bucket,
         count(*) FILTER (WHERE ct.status = 'ASSIGNED')::int              AS assigned,
         count(*) FILTER (WHERE ct.status = 'IN_PROGRESS')::int           AS in_progress,
         count(*) FILTER (WHERE ct.status = 'COMPLETED')::int             AS completed,
         count(*) FILTER (WHERE ct.status = 'REVOKED')::int               AS revoked,
         count(*) FILTER (WHERE ct.assigned_at >= $1)::int                AS assigned_today,
         count(*) FILTER (WHERE ct.status = 'COMPLETED' AND ct.completed_at >= $1)::int AS completed_today,
         count(*) FILTER (WHERE ct.status = 'COMPLETED' AND ct.completed_at >= $2 AND ct.completed_at < $1)::int AS completed_yesterday,
         count(*) FILTER (WHERE ct.status = 'COMPLETED' AND ct.completed_at >= $3)::int AS completed7d,
         count(*) FILTER (WHERE ${OVERDUE_SQL})::int AS overdue,
         min(ct.created_at) FILTER (WHERE ct.status = 'PENDING') AS oldest_unassigned_at
       FROM case_tasks ct JOIN cases cs ON cs.id = ct.case_id
       ${where}`,
      params,
    );
    // CASE-grain office queue (ADR-0032): cases awaiting the final verdict, scoped by the case leg.
    const caseParams: unknown[] = [];
    const casePred = caseScopePredicate(caseParams, scope);
    const [caseRow] = await query<{ awaitingCompletion: number }>(
      `SELECT count(*)::int AS awaiting_completion
       FROM cases cs
       WHERE cs.status = 'AWAITING_COMPLETION'${casePred ? ` AND (${casePred})` : ''}`,
      caseParams,
    );
    return { ...(row ?? ZERO), awaitingCompletion: caseRow?.awaitingCompletion ?? 0 };
  },

  /**
   * Portfolio rollup — one row per client × product in the actor's case scope, with pending
   * (NEW/IN_PROGRESS), completed and total case counts. SA/MANAGER only (billing.generate), scoped
   * via the CASE predicate. Heaviest aggregate, separate endpoint so it loads lazily.
   */
  async portfolio(actor: Actor): Promise<PortfolioRow[]> {
    const params: unknown[] = [];
    const scope = await resolveScope(actor);
    const predicate = caseScopePredicate(params, scope);
    const where = predicate ? `WHERE ${predicate}` : '';
    // GROUP BY the FK ids (clients/products `name` is NOT unique — only `code` is); two distinct
    // clients sharing a display name must stay separate rows, never a silently-summed rollup.
    return query<PortfolioRow>(
      `SELECT cs.client_id, cs.product_id, cl.name AS client_name, pr.name AS product_name,
              count(*) FILTER (WHERE cs.status IN ('NEW','IN_PROGRESS'))::int AS pending,
              count(*) FILTER (WHERE cs.status = 'COMPLETED')::int            AS completed,
              count(*)::int                                                  AS total
       FROM cases cs
       JOIN clients cl ON cl.id = cs.client_id
       JOIN products pr ON pr.id = cs.product_id
       ${where}
       GROUP BY cs.client_id, cs.product_id, cl.name, pr.name
       ORDER BY total DESC, cl.name, pr.name`,
      params,
    );
  },
};
