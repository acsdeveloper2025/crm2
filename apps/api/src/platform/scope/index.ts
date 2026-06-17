import { resolveScope, type Actor, type Scope } from './repository.js';
import { dimensionDef, type DimensionCode } from './dimensions.js';

// Re-export the DB-backed resolution + types so consumers import the whole seam from one place.
export { getScopedUserIds, resolveScope, type Actor, type Scope } from './repository.js';
export { DIMENSIONS, dimensionDef, type DimensionCode, type DimensionDef } from './dimensions.js';

/**
 * The master-data entity ids visible to an actor for a CLIENT/PRODUCT dimension — used to scope
 * dropdown options to a user's portfolio. RESTRICT caps (could be `[]` = none, fail-closed), EXPAND
 * lists the assigned set; `undefined` = no wiring for that dimension ⇒ unrestricted (e.g. SUPER_ADMIN
 * sees all). Returned ids are numeric (CLIENT/PRODUCT entity_id columns).
 */
export async function scopedEntityIds(actor: Actor, dimension: DimensionCode): Promise<number[] | undefined> {
  const scope = await resolveScope(actor);
  const restrict = scope.restrict?.[dimension];
  if (restrict !== undefined) return restrict.map(Number);
  const expand = scope.expand?.[dimension];
  if (expand !== undefined) return expand.map(Number);
  return undefined;
}

/**
 * Compose a resolved `Scope` into a list/detail WHERE predicate (ADR-0022 slice 4):
 *
 *     visible ⇔ (hierarchy leg OR any EXPAND-dimension leg) AND (every RESTRICT-dimension leg)
 *
 * `hierarchyLeg` receives the pushed `uuid[]` placeholder and returns the consumer's user-match
 * shape (e.g. cases: created-by OR a task assigned to an in-scope user). Returns `''` when there
 * is nothing to filter (hierarchy ALL + no RESTRICT wiring). A wired RESTRICT dimension with zero
 * assignments emits `= ANY('{}')` — matches nothing (fail-closed, never "all"). Dimension legs
 * come from the code-owned registry only (parameterized; the cases table is aliased `cs`).
 *
 * `level` picks the dimension-leg grain: 'CASE' (default) uses `casePredicate`; 'TASK'
 * (Pipeline task lists — FROM aliases `case_tasks ct` JOIN `cases cs`) prefers a dimension's
 * `taskPredicate`, falling back to its case leg (still valid through the joined `cs`).
 */
export function composeScopePredicate(
  params: unknown[],
  scope: Scope,
  hierarchyLeg: (userIdsPlaceholder: string) => string,
  level: 'CASE' | 'TASK' = 'CASE',
): string {
  const leg = (def: ReturnType<typeof dimensionDef>, values: Array<number | string>): string | undefined => {
    if (!def) return undefined;
    const fn = level === 'TASK' ? (def.taskPredicate ?? def.casePredicate) : def.casePredicate;
    return fn.call(def, params, values);
  };
  const orParts: string[] = [];
  if (scope.userIds !== undefined) {
    params.push(scope.userIds);
    orParts.push(hierarchyLeg(`$${params.length}::uuid[]`));
  }
  for (const [dimension, values] of Object.entries(scope.expand ?? {})) {
    if (!values || values.length === 0) continue;
    const fragment = leg(dimensionDef(dimension), values);
    if (fragment) orParts.push(fragment);
  }
  const andParts: string[] = [];
  for (const [dimension, values] of Object.entries(scope.restrict ?? {})) {
    // A RESTRICT cap must NEVER silently drop: a dimension wired in the DB but missing from the
    // code registry (deploy-order skew) fails CLOSED — the leg becomes FALSE, not absent.
    const fragment = values ? leg(dimensionDef(dimension), values) : undefined;
    andParts.push(fragment ?? 'FALSE');
  }
  const parts: string[] = [];
  if (orParts.length > 0) parts.push(`(${orParts.join(' OR ')})`);
  parts.push(...andParts);
  return parts.length > 0 ? `(${parts.join(' AND ')})` : '';
}

/**
 * The shared TASK-grain visibility predicate (Pipeline lists AND scoped task lookups before
 * assignment writes — one shape, so list visibility and write reachability never disagree).
 * FROM contract: `case_tasks ct` JOIN `cases cs`. Hierarchy leg: the task is assigned to an
 * in-scope user OR its case was created by one (the task-side mirror of the case predicate).
 * `''` = no filter (SUPER_ADMIN / hierarchy ALL with no caps).
 */
export function taskScopePredicate(params: unknown[], scope: Scope | undefined): string {
  if (!scope) return '';
  return composeScopePredicate(
    params,
    scope,
    (ph) => `ct.assigned_to = ANY(${ph}) OR cs.created_by = ANY(${ph})`,
    'TASK',
  );
}
