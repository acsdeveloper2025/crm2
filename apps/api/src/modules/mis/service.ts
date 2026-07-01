import type { MisColumnMeta, MisReportTypeMeta, MisRow, MisSummary, Paginated } from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import {
  resolvePage,
  resolveFilters,
  buildPage,
  type FilterField,
  type PageSpec,
} from '../../platform/pagination.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import {
  assertExportable,
  exportThreshold,
  type ExportColumn,
  type ResolvedExport,
} from '../../platform/export/index.js';
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

/** Summary caps the number of returned groups (the grand total still covers ALL matching rows). */
const MIS_SUMMARY_MAX_GROUPS = 500;

/** Groupable = an allowed, non-money TEXT/SELECT column. Grouping by a date/number/money is rejected. */
function isGroupable(c: MisColumn): boolean {
  return !c.money && (c.dataType === 'TEXT' || c.dataType === 'SELECT');
}

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

  /** Summary (grouped) format: group by one allowed non-money TEXT/SELECT column → task/outcome counts
   *  + billing.view-gated money totals. Filters are shared with rows; money totals are null without
   *  billing.view (the laterals aren't even joined). */
  async summary(
    type: string,
    rawQuery: Record<string, unknown>,
    actor: Actor,
    canViewBilling: boolean,
  ): Promise<MisSummary> {
    const rt = getReportType(type);
    if (!rt) throw AppError.notFound('MIS_REPORT_TYPE_NOT_FOUND');

    const allowed = allowedColumns(rt, canViewBilling);
    const byKey = new Map(allowed.map((c) => [c.key, c]));
    const groupKey = typeof rawQuery['group'] === 'string' ? rawQuery['group'].trim() : '';
    const groupCol = byKey.get(groupKey);
    if (!groupCol || !isGroupable(groupCol))
      throw AppError.badRequest('INVALID_MIS_GROUP', { group: groupKey });

    const filterMap: Record<string, FilterField> = {};
    for (const c of allowed) if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    const filters = resolveFilters(rawQuery, { sortMap: {}, filterMap, defaultSort: groupKey });
    const scope = await resolveScope(actor);

    const { rows, grandTotal } = await repo.summary({
      groupColumn: groupCol.sql,
      billing: canViewBilling,
      filters,
      scope,
      limit: MIS_SUMMARY_MAX_GROUPS,
    });
    return { groupBy: groupKey, rows, grandTotal };
  },

  /** Export the current (scoped, filtered, money-gated) view. Sync-only: a match count at/above the
   *  threshold 413s (the async job tier is deferred — its builder can't reconstruct scope/money). The
   *  visible columns come from `ex.cols`, restricted to the allowed set (money can never leak). */
  async exportData(
    type: string,
    rawQuery: Record<string, unknown>,
    ex: ResolvedExport,
    actor: Actor,
    canViewBilling: boolean,
  ): Promise<{ rows: MisRow[]; columns: ExportColumn<MisRow>[] }> {
    const rt = getReportType(type);
    if (!rt) throw AppError.notFound('MIS_REPORT_TYPE_NOT_FOUND');

    const allowed = allowedColumns(rt, canViewBilling);
    const allowedKeys = new Set(allowed.map((c) => c.key));
    // Visible columns from the grid's export request → allowed only (money-safe); else default-visible.
    const wanted = ex.cols.filter((k) => allowedKeys.has(k));
    const picked = allowed.filter((c) => wanted.includes(c.key));
    const cols = picked.length ? picked : allowed.filter((c) => c.defaultVisible);

    const filterMap: Record<string, FilterField> = {};
    for (const c of allowed) if (c.filterable) filterMap[c.key] = { column: c.sql, kind: filterKindFor(c) };
    const filters = resolveFilters(rawQuery, { sortMap: {}, filterMap, defaultSort: rt.defaultSort });
    const scope = await resolveScope(actor);

    // Pre-check the match count so an oversized set 413s BEFORE the full projection is fetched.
    const totalCount = await repo.count({ filters, scope });
    assertExportable(totalCount);

    const defaultCol = rt.columns.find((c) => c.key === rt.defaultSort);
    const { items } = await repo.rows({
      columns: cols,
      billing: canViewBilling,
      filters,
      scope,
      sortColumn: defaultCol ? defaultCol.sql : 'ct.created_at',
      sortOrder: 'desc',
      limit: Math.min(totalCount, exportThreshold()),
      offset: 0,
    });
    const columns: ExportColumn<MisRow>[] = cols.map((c) => ({
      id: c.key,
      header: c.label,
      value: (row) => row[c.key] ?? null,
    }));
    return { rows: items, columns };
  },
};
