import type { Policy, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const COLS = `
  id, code, name, description, content, content_version, is_active, effective_from,
  version, created_by, updated_by, created_at, updated_at`;

interface WriteInput {
  code: string;
  name: string;
  description: string | null;
  content: string;
  effectiveFrom: string | undefined;
}

/** Resolved, validated list options — `sortColumn`/`sortOrder` are whitelisted by the service. */
export interface PolicyListOptions {
  active?: boolean;
  search?: string;
  /** whitelisted per-column filters; columns trusted, values bound. */
  columnFilters?: AppliedFilter[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

export const policyRepository = {
  async list(o: PolicyListOptions): Promise<{ items: Policy[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      // `active=true` means USABLE = active AND in effect (ADR-0017).
      if (o.active) where.push(`effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM policies ${clause}`,
      params,
    );
    const totalCount = countRow?.count ?? 0;
    // sortColumn is whitelisted in the service (PageSpec.sortMap) → safe to interpolate.
    const items = await query<Policy>(
      `SELECT ${COLS} FROM policies ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount };
  },

  async findById(id: number): Promise<Policy | null> {
    const rows = await query<Policy>(`SELECT ${COLS} FROM policies WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: WriteInput, userId: string): Promise<Policy> {
    return withTransaction(async (q) => {
      const [row] = await q<Policy>(
        `INSERT INTO policies (code, name, description, content, effective_from, created_by, updated_by)
         VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()), $6, $6)
         RETURNING ${COLS}`,
        [input.code, input.name, input.description, input.content, input.effectiveFrom ?? null, userId],
      );
      if (!row) throw AppError.internal('insert returned no row');
      await appendAudit(
        {
          entityType: 'policies',
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
  },

  /** OCC-guarded update (ADR-0019). `bumpContent` ⇒ content_version + 1 (forces global re-accept);
   *  `version` bumps on every edit. 0 rows → 404 or 409 STALE_UPDATE. */
  async update(
    id: number,
    input: WriteInput,
    bumpContent: boolean,
    userId: string,
    expectedVersion: number,
    before: Policy,
  ): Promise<Policy> {
    return withTransaction(async (q) => {
      const [row] = await q<Policy>(
        `UPDATE policies SET
           code=$2, name=$3, description=$4, content=$5,
           effective_from = COALESCE($6::timestamptz, effective_from),
           content_version = content_version + $7,
           version = version + 1, updated_by=$8, updated_at=now()
         WHERE id=$1 AND version=$9
         RETURNING ${COLS}`,
        [
          id,
          input.code,
          input.name,
          input.description,
          input.content,
          input.effectiveFrom ?? null,
          bumpContent ? 1 : 0,
          userId,
          expectedVersion,
        ],
      );
      if (!row) {
        const [current] = await q<Policy>(`SELECT ${COLS} FROM policies WHERE id = $1`, [id]);
        if (!current) throw AppError.notFound('POLICY_NOT_FOUND');
        throw AppError.stale(current);
      }
      await appendAudit(
        {
          entityType: 'policies',
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
  },

  /** Acceptances for a single user (admin view, ADR-0043). Joins `consents` → `policies` by
   *  content_version for the policy code/name. LEFT JOIN: a consent row at a version whose policy was
   *  later deleted/renamed still surfaces, with null policy fields. Newest first. */
  async acceptancesForUser(userId: string): Promise<
    {
      id: string;
      policyId: number | null;
      policyCode: string | null;
      policyName: string | null;
      policyVersion: number;
      acceptedAt: string;
      ip: string | null;
      userAgent: string | null;
    }[]
  > {
    return query(
      `SELECT c.id, p.id AS policy_id, p.code AS policy_code, p.name AS policy_name,
              c.policy_version, c.accepted_at, c.ip::text AS ip, c.user_agent
         FROM consents c
         LEFT JOIN policies p ON p.content_version = c.policy_version
        WHERE c.user_id = $1
        ORDER BY c.accepted_at DESC`,
      [userId],
    );
  },

  /** Activate/deactivate are version-guarded edits too (ADR-0019). */
  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<Policy> {
    return withTransaction(async (q) => {
      const [before] = await q<Policy>(`SELECT ${COLS} FROM policies WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('POLICY_NOT_FOUND');
      const [row] = await q<Policy>(
        `UPDATE policies SET is_active=$2, version=version+1, updated_by=$3, updated_at=now()
         WHERE id=$1 AND version=$4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit(
        {
          entityType: 'policies',
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
