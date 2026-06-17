import type { User, UserView, UserOption, UserRole, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

const COLS = `id, username, name, email, employee_id, phone, department_id, designation_id,
  role, reports_to, is_active, mfa_required, effective_from, version, created_by, updated_by, created_at, updated_at`;

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === UNIQUE_VIOLATION)
    throw AppError.conflict('USER_EXISTS', 'a user with this username already exists');
  if (pgCode(e) === FK_VIOLATION) throw AppError.badRequest('INVALID_REFERENCE');
  if (pgCode(e) === CHECK_VIOLATION) throw AppError.badRequest('INVALID_MANAGER');
  throw e;
};

interface CreateUserRow {
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  designationId: number | null;
  role: UserRole;
  reportsTo: string | null;
  effectiveFrom?: string | undefined;
  /** pre-hashed initial password (optional); when set, password_hash + password_set_at are written. */
  passwordHash?: string | undefined;
}
interface UpdateUserRow {
  /** login rename (ADR-0020); when provided, updated (uniqueness-checked). undefined → unchanged. */
  username?: string | undefined;
  name: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  designationId: number | null;
  role: UserRole;
  reportsTo: string | null;
  effectiveFrom?: string | undefined;
  /** admin MFA-required flag; undefined → unchanged. */
  mfaRequired?: boolean | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface UserListOptions {
  role?: UserRole;
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters (§6/§7); columns trusted, values bound. */
  columnFilters?: AppliedFilter[];
  /** restrict to these ids (export `mode:'selected'`); applied on top of scope/filters, bound as a param. */
  ids?: string[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const userRepository = {
  async list(o: UserListOptions): Promise<{ items: UserView[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.role !== undefined) {
      params.push(o.role);
      where.push(`u.role = $${params.length}`);
    }
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`u.is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (o.active) where.push(`u.effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(u.username ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
    }
    // Per-column filters (§6/§7/§8) combine with AND; whitelisted columns, bound values.
    where.push(...filterClauses(o.columnFilters ?? [], params));
    // Selected-rows export (mode:'selected') — bound uuid id list, ANDed on top of scope/filters.
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`u.id = ANY($${params.length}::uuid[])`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users u ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<UserView>(
      `SELECT u.id, u.username, u.name, u.email, u.employee_id, u.phone, u.department_id, u.designation_id,
              u.role, u.reports_to, u.is_active, u.mfa_required, u.effective_from, u.version,
              u.created_by, u.updated_by, u.created_at, u.updated_at,
              m.name AS reports_to_name, dp.name AS department_name, dg.name AS designation_name
       FROM users u
       LEFT JOIN users m ON m.id = u.reports_to
       LEFT JOIN departments dp ON dp.id = u.department_id
       LEFT JOIN designations dg ON dg.id = u.designation_id
       ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, u.id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: string): Promise<User | null> {
    const rows = await query<User>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  /** One user as the joined display view (manager/department/designation names) — the self-profile
   *  read. Same column shape as `list`, scoped to a single id. */
  async profileView(id: string): Promise<UserView | null> {
    const rows = await query<UserView>(
      `SELECT u.id, u.username, u.name, u.email, u.employee_id, u.phone, u.department_id, u.designation_id,
              u.role, u.reports_to, u.is_active, u.mfa_required, u.effective_from, u.version,
              u.created_by, u.updated_by, u.created_at, u.updated_at,
              m.name AS reports_to_name, dp.name AS department_name, dg.name AS designation_name
       FROM users u
       LEFT JOIN users m ON m.id = u.reports_to
       LEFT JOIN departments dp ON dp.id = u.department_id
       LEFT JOIN designations dg ON dg.id = u.designation_id
       WHERE u.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  /** Self-service contact edit: a user changes only their OWN email + phone. Version-bumped + audited
   *  like every other write (an admin holding a stale row then gets a clean OCC conflict). */
  async updateSelfContact(
    id: string,
    input: { email: string | null; phone: string | null },
    before: User,
  ): Promise<User> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<User>(
          `UPDATE users SET email = $2, phone = $3, version = version + 1, updated_by = $1, updated_at = now()
           WHERE id = $1 RETURNING ${COLS}`,
          [id, input.email, input.phone],
        );
        if (!row) throw AppError.notFound('USER_NOT_FOUND');
        await appendAudit(
          {
            entityType: 'users',
            entityId: id,
            action: 'UPDATE',
            actorId: id,
            before,
            after: row,
            versionAfter: row.version,
          },
          q,
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** Unpaginated USABLE (active AND in effect — ADR-0017) user options for dropdowns (B-22). */
  async options(): Promise<UserOption[]> {
    return query<UserOption>(
      `SELECT id, username, name, role FROM users
       WHERE is_active AND effective_from <= now()
       ORDER BY name ASC`,
    );
  },

  async create(input: CreateUserRow, userId: string): Promise<User> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<User>(
          `INSERT INTO users (employee_id, username, name, email, phone, department_id, designation_id,
                  role, reports_to, effective_from,
                  password_hash, password_set_at, created_by, updated_by)
           VALUES ('CRM-' || lpad(nextval('user_employee_seq')::text, 5, '0'),
                  $1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()),
                  $10::text, CASE WHEN $10::text IS NOT NULL THEN now() ELSE NULL END, $11, $11) RETURNING ${COLS}`,
          [
            input.username,
            input.name,
            input.email,
            input.phone,
            input.departmentId,
            input.designationId,
            input.role,
            input.reportsTo,
            input.effectiveFrom ?? null,
            input.passwordHash ?? null,
            userId,
          ],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit(
          {
            entityType: 'users',
            entityId: row.id,
            action: 'CREATE',
            actorId: userId,
            after: row,
            versionAfter: row.version,
          },
          q,
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** OCC-guarded update (ADR-0019): applies only at `expectedVersion`; 0 rows → 404 or 409 STALE_UPDATE. */
  async update(
    id: string,
    input: UpdateUserRow,
    userId: string,
    expectedVersion: number,
    before: User,
  ): Promise<User> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<User>(
          `UPDATE users SET username = COALESCE($2, username), name = $3, email = $4,
                  phone = $5, department_id = $6, designation_id = $7, role = $8, reports_to = $9,
                  mfa_required = COALESCE($13::boolean, mfa_required),
                  effective_from = COALESCE($10::timestamptz, effective_from),
                  version = version + 1, updated_by = $11, updated_at = now()
           WHERE id = $1 AND version = $12 RETURNING ${COLS}`,
          [
            id,
            input.username ?? null,
            input.name,
            input.email,
            input.phone,
            input.departmentId,
            input.designationId,
            input.role,
            input.reportsTo,
            input.effectiveFrom ?? null,
            userId,
            expectedVersion,
            input.mfaRequired ?? null,
          ],
        );
        if (!row) {
          const [current] = await q<User>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('USER_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit(
          {
            entityType: 'users',
            entityId: id,
            action: 'UPDATE',
            actorId: userId,
            before,
            after: row,
            versionAfter: row.version,
          },
          q,
        );
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  async setPasswordHash(id: string, passwordHash: string, userId: string, mustChange = false): Promise<void> {
    const rows = await query<{ id: string }>(
      `UPDATE users SET password_hash = $2, password_set_at = now(), password_must_change = $4,
              updated_by = $3, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, passwordHash, userId, mustChange],
    );
    if (!rows[0]) throw AppError.notFound('USER_NOT_FOUND');
  },

  /** Profile photo (slice 7): set/replace the object-storage key. Returns the PREVIOUS key (so the
   *  caller can delete the orphaned object), or null when there was none / the user is missing. */
  async setPhotoKey(id: string, key: string, userId: string): Promise<{ previousKey: string | null } | null> {
    const rows = await query<{ previousKey: string | null }>(
      `UPDATE users u SET profile_photo_key = $2, updated_by = $3, updated_at = now()
       FROM (SELECT profile_photo_key FROM users WHERE id = $1) prev
       WHERE u.id = $1 RETURNING prev.profile_photo_key AS previous_key`,
      [id, key, userId],
    );
    return rows[0] ?? null;
  },

  /** The current profile-photo key, or null when the user has none / does not exist. */
  async photoKeyById(id: string): Promise<string | null> {
    const rows = await query<{ profilePhotoKey: string | null }>(
      `SELECT profile_photo_key FROM users WHERE id = $1`,
      [id],
    );
    return rows[0]?.profilePhotoKey ?? null;
  },

  /** Admin unlock — clear the failed-attempt counter and any active lockout. */
  async unlock(id: string, userId: string): Promise<void> {
    const rows = await query<{ id: string }>(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_by = $2, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id, userId],
    );
    if (!rows[0]) throw AppError.notFound('USER_NOT_FOUND');
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: string, isActive: boolean, userId: string, expectedVersion: number): Promise<User> {
    return withTransaction(async (q) => {
      const [before] = await q<User>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('USER_NOT_FOUND');
      const [row] = await q<User>(
        `UPDATE users SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'users',
          entityId: id,
          action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
          actorId: userId,
          before,
          after: row,
          versionAfter: row.version,
        },
        q,
      );
      return row;
    });
  },
};
