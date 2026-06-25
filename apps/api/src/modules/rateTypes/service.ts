import {
  CreateRateTypeSchema,
  UpdateRateTypeSchema,
  type Paginated,
  type RateType,
  type RateTypeOption,
} from '@crm2/sdk';
import { rateTypeRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';

/** Sortable + filterable columns (apiField → SQL column); only whitelisted columns reach ORDER BY /
 *  the WHERE clause (SQL-injection-safe). `code` is the immutable identity (Phase C FK key). */
const RATE_TYPE_PAGE_SPEC: PageSpec = {
  sortMap: {
    code: 'code',
    name: 'name',
    sortOrder: 'sort_order',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    effectiveFrom: 'effective_from',
  },
  filterMap: {
    category: { column: 'category', kind: 'text' },
    isActive: { column: 'is_active', kind: 'text' },
  },
  defaultSort: 'sortOrder',
  defaultOrder: 'asc',
};

/** Rate-type service — managed master-data catalog (ADR-0064). `code` is immutable (no import/export/bulk in Phase A). */
export const rateTypeService = {
  async list(rawQuery: Record<string, unknown>): Promise<Paginated<RateType>> {
    const r = resolvePage(rawQuery, RATE_TYPE_PAGE_SPEC);
    const active = rawQuery['active'] === 'true' ? true : rawQuery['active'] === 'false' ? false : undefined;
    const columnFilters = resolveFilters(rawQuery, RATE_TYPE_PAGE_SPEC);
    const { items, totalCount } = await repo.list({
      ...(active !== undefined ? { active } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (active !== undefined) filters['active'] = active;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  options: (activeOnly: boolean): Promise<RateTypeOption[]> => repo.options(activeOnly),

  findById: (id: number): Promise<RateType | null> => repo.findById(id),

  create(input: unknown, userId: string): Promise<RateType> {
    const v = CreateRateTypeSchema.parse(input); // throws ZodError → 400
    return repo.create(
      {
        code: v.code,
        name: v.name,
        description: v.description,
        category: v.category,
        sortOrder: v.sortOrder,
        effectiveFrom: v.effectiveFrom,
      },
      userId,
    );
  },

  async update(id: number, input: unknown, userId: string): Promise<RateType> {
    const v = UpdateRateTypeSchema.parse(input); // field validation (400 VALIDATION) — no `code`
    const expectedVersion = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
    return repo.update(
      id,
      {
        name: v.name,
        description: v.description,
        category: v.category,
        sortOrder: v.sortOrder,
        effectiveFrom: v.effectiveFrom,
      },
      userId,
      expectedVersion,
      existing,
    );
  },

  activate: (id: number, version: number, userId: string) => repo.setActive(id, true, userId, version),
  deactivate: (id: number, version: number, userId: string) => repo.setActive(id, false, userId, version),
};
