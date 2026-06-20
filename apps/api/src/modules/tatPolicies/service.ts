import {
  CreateTatPolicySchema,
  ReviseTatPolicySchema,
  type TatPolicy,
  type TatPolicyView,
  type Paginated,
} from '@crm2/sdk';
import { tatPolicyRepository as repo } from './repository.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';

/** Sortable + filterable columns (apiField → SQL column); only these reach ORDER BY. */
const TP_PAGE_SPEC: PageSpec = {
  sortMap: {
    tatHours: 'tat_hours',
    label: 'label',
    status: 'is_active',
    effectiveFrom: 'effective_from',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  filterMap: {
    label: { column: 'label', kind: 'text' },
    effectiveFrom: { column: 'effective_from', kind: 'date' },
    createdAt: { column: 'created_at', kind: 'date' },
  },
  defaultSort: 'tatHours',
  defaultOrder: 'asc',
};

/**
 * TAT policy service (ADR-0044) — the configurable turnaround-time band master.
 *  - create: a new band; the DB enforces one ACTIVE row per tat_hours
 *  - revise: effective-dated — a new version row; the prior is end-dated, never overwritten
 *  - (de)activate: OCC-guarded soft state
 */
export const tatPolicyService = {
  /** Active bands for a target-TAT dropdown (read-only; gated page.masterdata so case-creators can pick). */
  options(): Promise<{ id: number; tatHours: number; label: string }[]> {
    return repo.options();
  },

  async list(rawQuery: Record<string, unknown>): Promise<Paginated<TatPolicyView>> {
    const r = resolvePage(rawQuery, TP_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const history = rawQuery['history'] === 'true' ? true : undefined;
    const columnFilters = resolveFilters(rawQuery, TP_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(history !== undefined ? { history } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (active !== undefined) filters['active'] = active;
    if (history !== undefined) filters['history'] = history;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  create(input: unknown, userId: string): Promise<TatPolicy> {
    const validated = CreateTatPolicySchema.parse(input); // throws ZodError → 400
    return repo.create(validated, userId);
  },

  async revise(id: number, input: unknown, userId: string): Promise<TatPolicy> {
    const validated = ReviseTatPolicySchema.parse(input);
    const expectedVersion = requireVersion(input);
    return repo.revise(id, validated.label, validated.effectiveFrom ?? null, userId, expectedVersion);
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};

/** Ascending list of usable (active AND in effect) band hours — for the TAT classifier (no endpoint). */
export function listUsableHours(): Promise<number[]> {
  return repo.listUsableHours();
}
