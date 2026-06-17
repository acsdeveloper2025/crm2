import { query } from '../db.js';
import { getRoleAttributes } from '../access/index.js';
import type { DimensionCode } from './dimensions.js';

/**
 * Data-scope resolution (ADR-0022 slice 4) — the DB half of the scope seam. Answers "whose rows
 * may this actor see?" entirely from ROLE ATTRIBUTES (hierarchy mode) and the role's admin-edited
 * dimension wiring + the user's assignments. No role-name checks anywhere: an unknown/inactive
 * role fail-closes to SELF + no dimensions. Raw DB access lives here (a repository); the pure
 * SQL-fragment composition lives in `./index.ts`.
 */
export interface Actor {
  role: string;
  userId: string;
}

export interface Scope {
  /** in-scope operational user-ids; `undefined` = no hierarchy filter (hierarchy mode ALL). */
  userIds?: string[];
  /** EXPAND dimensions — assignments ADD visibility on top of the hierarchy leg. Dimensions with
   *  zero assignments are omitted (an empty expand leg must never appear). */
  expand?: Partial<Record<DimensionCode, Array<number | string>>>;
  /** RESTRICT dimensions — every leg CAPS visibility (ANDed). A wired RESTRICT dimension with
   *  zero assignments stays present with [] — fail-closed: the user sees nothing until assigned. */
  restrict?: Partial<Record<DimensionCode, Array<number | string>>>;
}

/** Depth cap on the reports_to recursion — a cycle/runaway guard (orgs are far shallower). */
const SUBTREE_DEPTH_CAP = 16;

/**
 * The operational user-ids whose rows `actor` may see, by the ROLE's hierarchy mode:
 *  ALL → `undefined` (no filter) · SUBTREE → self + recursive reports_to subtree ·
 *  DIRECT_TEAM → self + direct reports · SELF (and unknown roles, fail-closed) → `[self]`.
 */
export async function getScopedUserIds(actor: Actor): Promise<string[] | undefined> {
  const attrs = await getRoleAttributes(actor.role);
  const mode = attrs?.hierarchyMode ?? 'SELF';
  if (mode === 'ALL') return undefined;
  if (mode === 'SUBTREE') {
    const rows = await query<{ id: string }>(
      `WITH RECURSIVE subtree AS (
         SELECT id, 1 AS depth FROM users WHERE id = $1
         UNION ALL
         SELECT u.id, s.depth + 1 FROM users u JOIN subtree s ON u.reports_to = s.id WHERE s.depth < $2
       )
       SELECT id FROM subtree`,
      [actor.userId, SUBTREE_DEPTH_CAP],
    );
    return rows.map((r) => r.id);
  }
  if (mode === 'DIRECT_TEAM') {
    const rows = await query<{ id: string }>(`SELECT id FROM users WHERE id = $1 OR reports_to = $1`, [
      actor.userId,
    ]);
    return rows.map((r) => r.id);
  }
  return [actor.userId];
}

/** The role's ACTIVE dimension wiring: dimension → EXPAND | RESTRICT. */
async function roleDimensionModes(roleCode: string): Promise<Map<DimensionCode, 'EXPAND' | 'RESTRICT'>> {
  const rows = await query<{ dimensionCode: DimensionCode; mode: 'EXPAND' | 'RESTRICT' }>(
    `SELECT rsd.dimension_code, rsd.mode
     FROM role_scope_dimensions rsd
     JOIN scope_dimensions sd ON sd.code = rsd.dimension_code AND sd.is_active
     WHERE rsd.role_code = $1 AND rsd.is_active`,
    [roleCode],
  );
  return new Map(rows.map((r) => [r.dimensionCode, r.mode]));
}

/** The user's active assignments grouped by dimension (ID- and VALUE-kind merged per dimension). */
async function assignmentsByDimension(userId: string): Promise<Map<string, Array<number | string>>> {
  const rows = await query<{ dimensionCode: string; entityId: number | null; entityValue: string | null }>(
    `SELECT dimension_code, entity_id, entity_value
     FROM user_scope_assignments WHERE user_id = $1 AND is_active`,
    [userId],
  );
  const map = new Map<string, Array<number | string>>();
  for (const r of rows) {
    const v = r.entityId ?? r.entityValue;
    if (v === null) continue;
    map.set(r.dimensionCode, [...(map.get(r.dimensionCode) ?? []), v]);
  }
  return map;
}

/**
 * Resolve the full scope for an actor: the hierarchy layer (role's hierarchy mode) plus the
 * dimension layers — the user's assignments INTERSECTED with the role's active wiring (an
 * assignment whose dimension the role no longer holds is inert), split by the wiring's mode.
 */
export async function resolveScope(actor: Actor): Promise<Scope> {
  const attrs = await getRoleAttributes(actor.role);
  const mode = attrs?.hierarchyMode ?? 'SELF'; // unknown role → fail-closed
  const wiring = await roleDimensionModes(actor.role);

  const scope: Scope = {};
  if (mode !== 'ALL') {
    const ids = await getScopedUserIds(actor);
    if (ids !== undefined) scope.userIds = ids; // non-ALL modes always resolve a concrete set
  }
  if (wiring.size === 0) return scope;

  const assigned = await assignmentsByDimension(actor.userId);
  const expand: Scope['expand'] = {};
  const restrict: Scope['restrict'] = {};
  for (const [dimension, dimMode] of wiring) {
    const values = assigned.get(dimension) ?? [];
    if (dimMode === 'RESTRICT') {
      restrict[dimension] = values; // [] stays — fail-closed cap
    } else if (values.length > 0) {
      expand[dimension] = values; // empty EXPAND legs never emitted
    }
  }
  if (Object.keys(expand).length > 0) scope.expand = expand;
  if (Object.keys(restrict).length > 0) scope.restrict = restrict;
  return scope;
}
