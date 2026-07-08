import { AppError } from './errors.js';
import { HTTP_STATUS } from './http.js';

/**
 * Bulk OCC mutations (CONCURRENCY_AND_EDITING_STANDARD §1/§7): a batch of per-row,
 * version-guarded writes that returns a per-row result (OK / CONFLICT / NOT_FOUND) — never a
 * silent partial overwrite. Each row reuses the resource's existing OCC-guarded write (e.g.
 * `repo.setActive`); bulk does NOT invent a second write path.
 */

/** One row's intent: which row, at which version the user started from. */
export interface BulkItem {
  id: number | string;
  version: number;
}

export type BulkRowStatus = 'OK' | 'CONFLICT' | 'NOT_FOUND';

/** Per-row outcome of a bulk mutation. */
export interface BulkResult {
  results: { id: string; status: BulkRowStatus }[];
  okCount: number;
  conflictCount: number;
  notFoundCount: number;
}

/** Upper bound on a single synchronous bulk batch (larger ⇒ a background job, a later phase). */
export const MAX_BULK_ITEMS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate + parse a bulk request body `{ items: [{ id, version }] }`. Drops nothing silently —
 * a malformed item is a 400 (never a partial-but-wrong batch). `idKind` matches the resource's id
 * column so a bad id can't reach SQL.
 */
export function parseBulkItems(body: unknown, idKind: 'int' | 'uuid'): BulkItem[] {
  const raw = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw) || raw.length === 0) throw AppError.badRequest('BULK_ITEMS_REQUIRED');
  if (raw.length > MAX_BULK_ITEMS)
    throw AppError.badRequest('BULK_TOO_LARGE', { max: MAX_BULK_ITEMS, got: raw.length });
  return raw.map((r) => {
    const o = r as { id?: unknown; version?: unknown };
    const version = Number(o.version);
    if (!Number.isInteger(version) || version < 0) throw AppError.badRequest('BULK_ITEM_INVALID');
    if (idKind === 'int') {
      const id = Number(o.id);
      if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BULK_ITEM_INVALID');
      return { id, version };
    }
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) throw AppError.badRequest('BULK_ITEM_INVALID');
    return { id: o.id, version };
  });
}

/**
 * Validate + parse a bulk request body `{ ids: number[] }` — for a resource with NO version column
 * (no per-row OCC), e.g. rate-type-assignments `/bulk-deactivate` (UX-11). Same 400s as
 * `parseBulkItems` (empty/oversized/malformed), so both bulk shapes fail the same way.
 */
export function parseBulkIds(body: unknown): number[] {
  const raw = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(raw) || raw.length === 0) throw AppError.badRequest('BULK_ITEMS_REQUIRED');
  if (raw.length > MAX_BULK_ITEMS)
    throw AppError.badRequest('BULK_TOO_LARGE', { max: MAX_BULK_ITEMS, got: raw.length });
  return raw.map((r) => {
    const id = Number(r);
    if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BULK_ITEM_INVALID');
    return id;
  });
}

/**
 * Run `apply` for each item, classifying the outcome per row. A stale row (409 STALE_UPDATE) →
 * CONFLICT; a missing row (404) → NOT_FOUND; both are reported, not retried. Any other error
 * propagates (a real failure must not be swallowed as a per-row status).
 */
export async function applyBulkOcc(
  items: BulkItem[],
  apply: (id: BulkItem['id'], version: number) => Promise<unknown>,
): Promise<BulkResult> {
  const results: BulkResult['results'] = [];
  let okCount = 0;
  let conflictCount = 0;
  let notFoundCount = 0;
  for (const it of items) {
    try {
      await apply(it.id, it.version);
      results.push({ id: String(it.id), status: 'OK' });
      okCount += 1;
    } catch (e) {
      // A stale row (409 STALE_UPDATE) or a row the resource refuses to change (e.g. a SYSTEM_UNIT_LOCKED
      // verification unit) → CONFLICT for that row; the rest of the batch still applies (never a 500).
      if (e instanceof AppError && (e.code === 'STALE_UPDATE' || e.code === 'SYSTEM_UNIT_LOCKED')) {
        results.push({ id: String(it.id), status: 'CONFLICT' });
        conflictCount += 1;
      } else if (e instanceof AppError && e.status === HTTP_STATUS.NOT_FOUND) {
        results.push({ id: String(it.id), status: 'NOT_FOUND' });
        notFoundCount += 1;
      } else {
        throw e;
      }
    }
  }
  return { results, okCount, conflictCount, notFoundCount };
}
