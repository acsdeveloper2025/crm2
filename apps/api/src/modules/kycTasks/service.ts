import type { KycQueueState, KycTaskRow, Paginated } from '@crm2/sdk';
import { KYC_QUEUE_STATES } from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import {
  resolvePage,
  resolveFilters,
  buildPage,
  type FilterField,
  type PageSpec,
} from '../../platform/pagination.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { KYC_QUEUE_COLUMNS, KYC_QUEUE_COLUMNS_BY_KEY, type KycQueueColumn } from './columns.js';
import { kycTasksRepository as repo } from './repository.js';

/**
 * KYC-queue service (ADR-0085, MIS validation pattern): strict, fail-closed request handling —
 * unknown state / column / sort key → 400, never silently defaulted or interpolated.
 */

const filterKindFor = (c: KycQueueColumn): FilterField['kind'] =>
  c.filterKind ?? (c.dataType === 'DATE' ? 'date' : 'text');

function parseState(raw: unknown): KycQueueState {
  const state = typeof raw === 'string' ? raw.trim() : '';
  if (!(KYC_QUEUE_STATES as readonly string[]).includes(state))
    throw AppError.badRequest('UNKNOWN_KYC_QUEUE_STATE', { state });
  return state as KycQueueState;
}

export function resolveColumns(rawCols: unknown): KycQueueColumn[] {
  const raw = typeof rawCols === 'string' ? rawCols : '';
  if (raw.trim()) {
    const seen = new Set<string>();
    const columns = raw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => {
        if (seen.has(k)) throw AppError.badRequest('DUPLICATE_KYC_QUEUE_COLUMN', { column: k });
        seen.add(k);
        const c = KYC_QUEUE_COLUMNS_BY_KEY.get(k);
        if (!c) throw AppError.badRequest('UNKNOWN_KYC_QUEUE_COLUMN', { column: k });
        return c;
      });
    if (columns.length) return columns;
  }
  return KYC_QUEUE_COLUMNS.filter((c) => c.defaultVisible);
}

export const kycTasksService = {
  async list(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<KycTaskRow>> {
    const state = parseState(rawQuery['state']);
    const columns = resolveColumns(rawQuery['cols']);

    const sortMap: Record<string, string> = {};
    const filterMap: Record<string, FilterField> = {};
    for (const c of KYC_QUEUE_COLUMNS) {
      if (c.sortable) sortMap[c.key] = c.sql;
      if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    }
    const sortBy = rawQuery['sortBy'];
    if (typeof sortBy === 'string' && sortBy.trim() && !(sortBy in sortMap))
      throw AppError.badRequest('UNKNOWN_KYC_QUEUE_SORT', { sortBy });

    const spec: PageSpec = {
      sortMap,
      filterMap,
      // The work list reads newest-assigned first; the done list newest-exported first.
      defaultSort: state === 'TO_EXPORT' ? 'assignedAt' : 'exportedAt',
      defaultOrder: 'desc',
    };
    const r = resolvePage(rawQuery, spec);
    const filters = resolveFilters(rawQuery, spec);
    const scope = await resolveScope(actor);

    const { items, totalCount } = await repo.rows({
      state,
      columns,
      filters,
      scope,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    return buildPage(items, totalCount, r);
  },
};
