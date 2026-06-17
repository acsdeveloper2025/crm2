import { query, withTransaction } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { SavedView, SavedViewState } from '@crm2/sdk';

/** camelize() bridges snake→camel, so resource_key/is_default/created_at land camelCased. */
const SELECT_COLS = 'id, resource_key, name, state, is_default, created_at, updated_at';

const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';

/** A duplicate (user, resource, name) → 409 (mirrors the master-data code-exists mapping). */
const NAME_EXISTS = (name?: string): AppError =>
  AppError.conflict('SAVED_VIEW_NAME_EXISTS', `a view named "${name ?? ''}" already exists for this list`);

export interface CreateRow {
  userId: string;
  resourceKey: string;
  name: string;
  state: SavedViewState;
  isDefault: boolean;
}

/**
 * Saved DataGrid views persistence (B-5). EVERY read and write is filtered by `user_id` — the
 * own-user scope is enforced here, there is no cross-user path. A duplicate (user, resource, name)
 * surfaces as a 23505 the service maps to 409; at most one default per (user, resource) is held by a
 * partial unique index, so set-default clears the prior default in the SAME transaction.
 */
export const savedViewRepository = {
  listByResource(userId: string, resourceKey: string): Promise<SavedView[]> {
    return query<SavedView>(
      `SELECT ${SELECT_COLS} FROM saved_views
       WHERE user_id = $1 AND resource_key = $2
       ORDER BY is_default DESC, name ASC`,
      [userId, resourceKey],
    );
  },

  /** Create a view; when `isDefault`, clear any sibling default first (same tx → the partial index holds). */
  async create(r: CreateRow): Promise<SavedView> {
    try {
      return await withTransaction(async (q) => {
        if (r.isDefault)
          await q(
            `UPDATE saved_views SET is_default = false, updated_at = now()
             WHERE user_id = $1 AND resource_key = $2 AND is_default`,
            [r.userId, r.resourceKey],
          );
        const rows = await q<SavedView>(
          `INSERT INTO saved_views (user_id, resource_key, name, state, is_default)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING ${SELECT_COLS}`,
          [r.userId, r.resourceKey, r.name, JSON.stringify(r.state), r.isDefault],
        );
        const row = rows[0];
        if (!row) throw new Error('saved_view insert produced no row');
        return row;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw NAME_EXISTS(r.name);
      throw e;
    }
  },

  /** Rename and/or re-capture state of one own view. Returns null if absent (→ 404 in the service). */
  async update(
    userId: string,
    id: string,
    fields: { name?: string; state?: SavedViewState },
  ): Promise<SavedView | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.name !== undefined) {
      params.push(fields.name);
      sets.push(`name = $${params.length}`);
    }
    if (fields.state !== undefined) {
      params.push(JSON.stringify(fields.state));
      sets.push(`state = $${params.length}::jsonb`);
    }
    sets.push('updated_at = now()');
    params.push(id, userId);
    try {
      const rows = await query<SavedView>(
        `UPDATE saved_views SET ${sets.join(', ')}
         WHERE id = $${params.length - 1} AND user_id = $${params.length}
         RETURNING ${SELECT_COLS}`,
        params,
      );
      return rows[0] ?? null;
    } catch (e) {
      if (isUniqueViolation(e)) throw NAME_EXISTS(fields.name);
      throw e;
    }
  },

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `DELETE FROM saved_views WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return rows.length > 0;
  },

  /**
   * Set/clear the default view. Setting clears the prior default for the same (user, resource) in one
   * transaction (the partial unique index would otherwise reject two defaults). Returns the updated
   * row, or null if the id isn't the caller's.
   */
  setDefault(userId: string, id: string, isDefault: boolean): Promise<SavedView | null> {
    return withTransaction(async (q) => {
      const owned = await q<{ resourceKey: string }>(
        `SELECT resource_key FROM saved_views WHERE id = $1 AND user_id = $2`,
        [id, userId],
      );
      const resourceKey = owned[0]?.resourceKey;
      if (resourceKey === undefined) return null;
      if (isDefault)
        await q(
          `UPDATE saved_views SET is_default = false, updated_at = now()
           WHERE user_id = $1 AND resource_key = $2 AND is_default AND id <> $3`,
          [userId, resourceKey, id],
        );
      const rows = await q<SavedView>(
        `UPDATE saved_views SET is_default = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING ${SELECT_COLS}`,
        [id, userId, isDefault],
      );
      return rows[0] ?? null;
    });
  },
};
