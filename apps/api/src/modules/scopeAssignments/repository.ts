import type { ScopeAssignmentItem, UserScopeAssignments } from '@crm2/sdk';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { dimensionDef, type DimensionDef } from '../../platform/scope/dimensions.js';

interface RawAssignment {
  id: number;
  dimensionCode: string;
  entityId: number | null;
  entityValue: string | null;
}

/** Resolve display labels for one dimension's ID-kind assignments from its catalog table. */
async function labelsFor(def: DimensionDef, ids: number[]): Promise<Map<number, string>> {
  // catalogTable/labelExpr come from the code-owned registry (never user input) — safe to interpolate.
  const rows = await query<{ id: number; label: string }>(
    `SELECT e.id, ${def.labelExpr} AS label FROM ${def.catalogTable!} e WHERE e.id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.label]));
}

/**
 * The SQL expression that re-derives, per ID-kind dimension, the EXACT `Entity` token the bulk-import
 * resolver (`resolveImportRow`) parses back — so an exported file round-trips through import (IE-DEFER-6):
 *  • PINCODE → the bare pincode (`resolveImportRow` looks up ALL its area rows);
 *  • AREA    → `pincode:area` (the `PINCODE:AREA` form `resolveImportRow` splits on `:`);
 *  • code-keyed catalogs (CLIENT/PRODUCT) → the catalog `code` (`catalogIdByCode`).
 * Keyed off the code-owned registry (`dimensionCode`/`catalogTable`, never user input) — safe to
 * interpolate. VALUE-kind dimensions are excluded: their `entity_value` is already the import token.
 */
function importCodeExpr(def: DimensionDef): string {
  if (def.code === 'PINCODE') return `e.pincode`;
  if (def.code === 'AREA') return `e.pincode || ':' || e.area`;
  return `e.code`; // clients / products / verification_units — UPPER_SNAKE code
}

/** Resolve the round-trippable import `Entity` token for one dimension's ID-kind assignments. */
async function importCodesFor(def: DimensionDef, ids: number[]): Promise<Map<number, string>> {
  const rows = await query<{ id: number; code: string }>(
    `SELECT e.id, ${importCodeExpr(def)} AS code FROM ${def.catalogTable!} e WHERE e.id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.code]));
}

/** One exported assignment row (the all-assignments DataGrid-style export). */
export interface ScopeExportRow {
  username: string;
  name: string;
  role: string;
  dimensionCode: string;
  entityId: number | null;
  entityValue: string | null;
  /** Human-readable label (display only — NOT importable). */
  label: string;
  /** The exact `Entity` token the bulk import parses back (code / pincode / pincode:area / value). */
  entityCode: string;
  createdAt: string;
}

export const scopeAssignmentRepository = {
  /** The target user's role — the role's dimension wiring governs what may be assigned. */
  async targetRole(userId: string): Promise<string | undefined> {
    const rows = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [userId]);
    return rows[0]?.role;
  },

  /** Bulk-import resolution: username → user id (usable identity only). */
  async userIdByUsername(username: string): Promise<string | undefined> {
    const rows = await query<{ id: string }>(`SELECT id FROM users WHERE username = $1 AND is_active`, [
      username,
    ]);
    return rows[0]?.id;
  },

  /** A postal pincode string → ALL its `locations` rows (a pincode spans many areas). */
  async locationIdsByPincode(pincode: string): Promise<number[]> {
    const rows = await query<{ id: number }>(`SELECT id FROM locations WHERE pincode = $1 AND is_active`, [
      pincode,
    ]);
    return rows.map((r) => r.id);
  },

  /** One `pincode:area` pair → its locations row (exact case-insensitive — no pattern matching). */
  async locationIdByPincodeArea(pincode: string, area: string): Promise<number | undefined> {
    const rows = await query<{ id: number }>(
      `SELECT id FROM locations WHERE pincode = $1 AND lower(area) = lower($2) AND is_active`,
      [pincode, area],
    );
    return rows[0]?.id;
  },

  /** A catalog CODE → id for the code-keyed catalogs (clients/products/verification_units). */
  async catalogIdByCode(def: DimensionDef, code: string): Promise<number | undefined> {
    // catalogTable comes from the code-owned registry (never user input) — safe to interpolate.
    const rows = await query<{ id: number }>(
      `SELECT id FROM ${def.catalogTable!} WHERE upper(code) = upper($1)`,
      [code],
    );
    return rows[0]?.id;
  },

  /**
   * Every active assignment joined with its user, resolved per dimension for export. Each row carries
   * both a display `label` (human-readable) and an `entityCode` — the exact `Entity` token the bulk
   * import parses back (IE-DEFER-6 round-trip): the catalog code, the pincode, the `pincode:area`
   * pair, or the raw value for VALUE-kind dimensions.
   */
  async allForExport(limit: number): Promise<ScopeExportRow[]> {
    const raw = await query<Omit<ScopeExportRow, 'label' | 'entityCode'>>(
      `SELECT u.username, u.name, u.role, a.dimension_code, a.entity_id, a.entity_value, a.created_at
       FROM user_scope_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.is_active ORDER BY u.username, a.dimension_code, a.id
       LIMIT $1`,
      [limit],
    );
    const idsByDim = new Map<string, number[]>();
    for (const r of raw) {
      if (r.entityId !== null)
        idsByDim.set(r.dimensionCode, [...(idsByDim.get(r.dimensionCode) ?? []), r.entityId]);
    }
    const labelMaps = new Map<string, Map<number, string>>();
    const codeMaps = new Map<string, Map<number, string>>();
    for (const [dim, ids] of idsByDim) {
      const def = dimensionDef(dim);
      if (def?.catalogTable) {
        labelMaps.set(dim, await labelsFor(def, ids));
        codeMaps.set(dim, await importCodesFor(def, ids));
      }
    }
    return raw.map((r) => ({
      ...r,
      label: r.entityValue ?? labelMaps.get(r.dimensionCode)?.get(r.entityId ?? -1) ?? String(r.entityId),
      // VALUE-kind dimensions: entity_value IS the import token; ID-kind: the resolved code/pincode/pair.
      entityCode: r.entityValue ?? codeMaps.get(r.dimensionCode)?.get(r.entityId ?? -1) ?? String(r.entityId),
    }));
  },

  /** The dimensions a role may hold (active wiring only) → dimension_code → mode. */
  async roleDimensions(roleCode: string): Promise<Map<string, string>> {
    const rows = await query<{ dimensionCode: string; mode: string }>(
      `SELECT rsd.dimension_code, rsd.mode
       FROM role_scope_dimensions rsd
       JOIN scope_dimensions sd ON sd.code = rsd.dimension_code AND sd.is_active
       WHERE rsd.role_code = $1 AND rsd.is_active`,
      [roleCode],
    );
    return new Map(rows.map((r) => [r.dimensionCode, r.mode]));
  },

  /** Every active assignment of the user, grouped by dimension with display labels. */
  async listForUser(userId: string): Promise<UserScopeAssignments> {
    const raw = await query<RawAssignment>(
      `SELECT id, dimension_code, entity_id, entity_value
       FROM user_scope_assignments WHERE user_id = $1 AND is_active
       ORDER BY dimension_code, id`,
      [userId],
    );
    const grouped: Record<string, ScopeAssignmentItem[]> = {};
    const idsByDim = new Map<string, number[]>();
    for (const a of raw) {
      if (a.entityId !== null) {
        idsByDim.set(a.dimensionCode, [...(idsByDim.get(a.dimensionCode) ?? []), a.entityId]);
      }
    }
    const labelMaps = new Map<string, Map<number, string>>();
    for (const [dim, ids] of idsByDim) {
      const def = dimensionDef(dim);
      if (def?.catalogTable) labelMaps.set(dim, await labelsFor(def, ids));
    }
    for (const a of raw) {
      const label =
        a.entityValue ?? labelMaps.get(a.dimensionCode)?.get(a.entityId ?? -1) ?? String(a.entityId);
      (grouped[a.dimensionCode] ??= []).push({
        id: a.id,
        entityId: a.entityId,
        entityValue: a.entityValue,
        label,
      });
    }
    return grouped;
  },

  /** ID-kind reference check: every id must exist in the dimension's catalog table. */
  async existingIds(def: DimensionDef, ids: number[]): Promise<number[]> {
    const rows = await query<{ id: number }>(
      `SELECT id FROM ${def.catalogTable!} WHERE id = ANY($1::int[])`,
      [ids],
    );
    return rows.map((r) => r.id);
  },

  /** VALUE-kind reference check: every value must exist in the locations column. */
  async existingValues(def: DimensionDef, values: string[]): Promise<string[]> {
    const rows = await query<{ v: string }>(
      `SELECT DISTINCT ${def.valueColumn!} AS v FROM locations WHERE ${def.valueColumn!} = ANY($1::text[])`,
      [values],
    );
    return rows.map((r) => r.v);
  },

  /** Idempotent add (re-adding re-activates); audited as one config UPDATE on the user's scope. */
  async add(
    userId: string,
    dimension: string,
    o: { entityIds?: number[]; entityValues?: string[] },
    assignedBy: string,
    before: UserScopeAssignments,
  ): Promise<void> {
    await withTransaction(async (q) => {
      if (o.entityIds?.length) {
        await q(
          `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id, assigned_by)
           SELECT $1, $2, x, $4 FROM unnest($3::int[]) AS x
           ON CONFLICT (user_id, dimension_code, entity_id) WHERE entity_id IS NOT NULL
           DO UPDATE SET is_active = true`,
          [userId, dimension, o.entityIds, assignedBy],
        );
      }
      if (o.entityValues?.length) {
        await q(
          `INSERT INTO user_scope_assignments (user_id, dimension_code, entity_value, assigned_by)
           SELECT $1, $2, x, $4 FROM unnest($3::text[]) AS x
           ON CONFLICT (user_id, dimension_code, entity_value) WHERE entity_value IS NOT NULL
           DO UPDATE SET is_active = true`,
          [userId, dimension, o.entityValues, assignedBy],
        );
      }
      await appendAudit(
        {
          entityType: 'user_scope',
          entityId: userId,
          action: 'UPDATE',
          actorId: assignedBy,
          before,
          after: { added: { dimension, ...o } },
        },
        q,
      );
    });
  },

  /** Owner-scoped removal (assignment must belong to the user) → true when a row was deleted. */
  async remove(userId: string, assignmentId: number, actorId: string): Promise<boolean> {
    return withTransaction(async (q) => {
      const rows = await q<{ id: number; dimensionCode: string }>(
        `DELETE FROM user_scope_assignments WHERE id = $1 AND user_id = $2
         RETURNING id, dimension_code`,
        [assignmentId, userId],
      );
      const removed = rows[0];
      if (!removed) return false;
      await appendAudit(
        {
          entityType: 'user_scope',
          entityId: userId,
          action: 'UPDATE',
          actorId,
          after: { removed: { assignmentId, dimension: removed.dimensionCode } },
        },
        q,
      );
      return true;
    });
  },
};
