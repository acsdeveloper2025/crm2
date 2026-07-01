import type { MisColumnMeta, MisReportTypeMeta, MisRow, Paginated } from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import {
  resolvePage,
  resolveFilters,
  buildPage,
  type FilterField,
  type PageSpec,
} from '../../platform/pagination.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { MIS_REPORT_TYPES, getReportType, type MisColumn, type MisReportType } from './reportTypes.js';
import { misRepository as repo } from './repository.js';

/** Columns the actor may see: money columns require billing.view (dropped otherwise — never leaked). */
function allowedColumns(rt: MisReportType, canViewBilling: boolean): MisColumn[] {
  return rt.columns.filter((c) => !c.money || canViewBilling);
}

function toMeta(c: MisColumn): MisColumnMeta {
  return {
    key: c.key,
    label: c.label,
    group: c.group,
    dataType: c.dataType,
    money: !!c.money,
    sortable: !!c.sortable,
    filterable: !!c.filterable,
    defaultVisible: !!c.defaultVisible,
  };
}

const filterKindFor = (c: MisColumn): FilterField['kind'] =>
  c.filterKind ?? (c.dataType === 'DATE' ? 'date' : c.dataType === 'SELECT' ? 'code' : 'text');

export const misService = {
  /** The catalog the picker renders. Money columns are omitted entirely without billing.view. */
  reportTypes(canViewBilling: boolean): MisReportTypeMeta[] {
    return MIS_REPORT_TYPES.map((rt) => ({
      type: rt.type,
      label: rt.label,
      defaultSort: rt.defaultSort,
      columns: allowedColumns(rt, canViewBilling).map(toMeta),
    }));
  },

  async list(
    type: string,
    rawQuery: Record<string, unknown>,
    actor: Actor,
    canViewBilling: boolean,
  ): Promise<Paginated<MisRow>> {
    const rt = getReportType(type);
    if (!rt) throw AppError.notFound('MIS_REPORT_TYPE_NOT_FOUND');

    const allowed = allowedColumns(rt, canViewBilling);
    const byKey = new Map(allowed.map((c) => [c.key, c]));

    // Column selection — strict, fail-closed. Only keys in the allowed set; no unknown, no duplicate.
    // A money key requested without billing.view is not in `allowed` → 400 (can never leak money).
    const rawCols = typeof rawQuery['cols'] === 'string' ? rawQuery['cols'] : '';
    let columns: MisColumn[];
    if (rawCols.trim()) {
      const seen = new Set<string>();
      columns = rawCols
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => {
          if (seen.has(k)) throw AppError.badRequest('DUPLICATE_MIS_COLUMN', { column: k });
          seen.add(k);
          const c = byKey.get(k);
          if (!c) throw AppError.badRequest('UNKNOWN_MIS_COLUMN', { column: k });
          return c;
        });
    } else {
      columns = allowed.filter((c) => c.defaultVisible);
    }
    if (columns.length === 0) columns = allowed.filter((c) => c.defaultVisible); // never emit an empty SELECT

    // Sort/filter maps from ALLOWED columns only. Money is never sortable/filterable in the registry, so
    // it can never reach ORDER BY / WHERE (no ordering or bisection oracle).
    const sortMap: Record<string, string> = {};
    const filterMap: Record<string, FilterField> = {};
    for (const c of allowed) {
      if (c.sortable) sortMap[c.key] = c.sql;
      if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    }
    // Strict sort validation: an explicit unknown/non-sortable sortBy is rejected, not silently defaulted.
    const sortBy = rawQuery['sortBy'];
    if (typeof sortBy === 'string' && sortBy.trim() && !(sortBy in sortMap))
      throw AppError.badRequest('UNKNOWN_MIS_SORT', { sortBy });

    const spec: PageSpec = { sortMap, filterMap, defaultSort: rt.defaultSort, defaultOrder: 'desc' };
    const r = resolvePage(rawQuery, spec);
    const filters = resolveFilters(rawQuery, spec);
    const scope = await resolveScope(actor);

    const { items, totalCount } = await repo.rows({
      columns,
      billing: canViewBilling,
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
