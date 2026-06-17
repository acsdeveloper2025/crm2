import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type Paginated, type SortOrder } from '@crm2/sdk';
import { AppError } from './errors.js';

/**
 * Server-side pagination helper (SoT: docs/PAGINATION_AND_LOADING_STANDARDS.md §1/§4).
 * `resolvePage` validates the raw query (clamps page, rejects `limit > 500`, whitelists
 * the sort column so it is safe to interpolate into `ORDER BY`) and `buildPage` assembles
 * the fixed `Paginated<T>` envelope. Every list endpoint goes through this — no bespoke
 * pagination formats.
 */
/**
 * A whitelisted, server-side column filter (DATAGRID_STANDARD §6 column search / §7 header
 * filter / §8 multi-column). `column` is the trusted SQL column (safe to interpolate, like
 * sortMap). `text` → `ILIKE '%value%'`; `enum` → equality against `values` (anything else is
 * rejected, never reaching SQL). The grid sends each as the request param `f_<apiField>`.
 */
export interface FilterField {
  column: string;
  /** `code` = enum-shaped multi-select over an OPEN catalog (ADR-0022 roles): values are
   *  UPPER_SNAKE-shape-validated instead of checked against a closed list. */
  kind: 'text' | 'enum' | 'code' | 'date';
  /** allowed values for kind:'enum'; a value outside the set is ignored (not an error). */
  values?: readonly string[];
}

export interface PageSpec {
  /** apiField → safe SQL column. Only these fields are sortable; the value is trusted in ORDER BY. */
  sortMap: Record<string, string>;
  /** apiField → whitelisted column filter. Only these fields are filterable (DATAGRID_STANDARD §6/§8). */
  filterMap?: Record<string, FilterField>;
  /** default apiField to sort by (must be a key of sortMap). */
  defaultSort: string;
  defaultOrder?: SortOrder;
}

/**
 * A resolved, validated column filter ready for a repo to append to its WHERE/params.
 * `text` → one `ilike` value; `enum` → `eq` (one value) or `in` (multi-select, §7) — every
 * value already validated against the allowed set.
 */
export interface AppliedFilter {
  /** echo key suffix (e.g. `code`, `createdAt_from`) — `f_<field>` is echoed into the envelope. */
  field: string;
  /** whitelisted SQL column — safe to interpolate. */
  column: string;
  op: 'ilike' | 'eq' | 'in' | 'gte' | 'lt';
  /** validated values (ilike/eq/gte/lt → 1; in → ≥1). The repo binds these as parameters. */
  values: string[];
}

/** Accept only `YYYY-MM-DD` (a date input's value) — anything else is dropped (no SQL exposure). */
const isIsoDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Parse the request's `f_<apiField>` params against the spec's filterMap. Unknown fields and
 * out-of-set enum values are silently dropped (robust to stale/tampered URLs) — only whitelisted
 * columns ever reach SQL. Enum filters accept a comma-separated multi-select (§7) → `in`.
 * Returns the filters to apply; the repo binds each value as a parameter (never interpolated).
 */
export function resolveFilters(query: Record<string, unknown>, spec: PageSpec): AppliedFilter[] {
  if (!spec.filterMap) return [];
  const out: AppliedFilter[] = [];
  for (const [field, def] of Object.entries(spec.filterMap)) {
    // Date-range filters read `f_<field>_from` / `f_<field>_to` (either bound optional); the
    // half-open `[from, to+1day)` window is built in filterClauses so `to` is an inclusive day.
    if (def.kind === 'date') {
      const from = query[`f_${field}_from`];
      const to = query[`f_${field}_to`];
      if (typeof from === 'string' && isIsoDate(from.trim()))
        out.push({ field: `${field}_from`, column: def.column, op: 'gte', values: [from.trim()] });
      if (typeof to === 'string' && isIsoDate(to.trim()))
        out.push({ field: `${field}_to`, column: def.column, op: 'lt', values: [to.trim()] });
      continue;
    }
    const raw = query[`f_${field}`];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    if (def.kind === 'enum' || def.kind === 'code') {
      // comma-separated multi-select; keep only legal values, de-duplicated, in request order.
      // enum → closed allowed-list; code → open catalog, UPPER_SNAKE shape only (existence is
      // the data's concern — an unknown code simply matches nothing).
      const legal = (v: string): boolean =>
        def.kind === 'enum' ? (def.values?.includes(v) ?? false) : /^[A-Z][A-Z0-9_]{1,31}$/.test(v);
      const values = [
        ...new Set(
          raw
            .split(',')
            .map((v) => v.trim())
            .filter(legal),
        ),
      ];
      if (values.length === 0) continue;
      out.push({ field, column: def.column, op: values.length > 1 ? 'in' : 'eq', values });
    } else {
      out.push({ field, column: def.column, op: 'ilike', values: [raw.trim()] });
    }
  }
  return out;
}

/**
 * Escape LIKE/ILIKE wildcards in a user-supplied value so `%` and `_` are matched literally,
 * then wrap as a contains-pattern (`%value%`). Postgres' default LIKE escape char is `\`, so the
 * backslash is escaped first. The result is bound as a parameter (never interpolated). Use this at
 * EVERY search/ILIKE site so a user typing `%` or `_` can't turn the box into a wildcard (D1).
 */
export function likeContains(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

/**
 * Build parameterized WHERE fragments for the resolved column filters, pushing each bound value
 * onto the shared `params` array (so `$N` indices stay correct alongside the repo's other params).
 * `column` is whitelisted (from filterMap) — safe to interpolate; values are ALWAYS bound.
 */
export function filterClauses(filters: AppliedFilter[], params: unknown[]): string[] {
  const clauses: string[] = [];
  for (const f of filters) {
    if (f.op === 'in') {
      params.push(f.values);
      clauses.push(`${f.column} = ANY($${params.length})`);
    } else if (f.op === 'ilike') {
      params.push(likeContains(f.values[0] ?? ''));
      clauses.push(`${f.column} ILIKE $${params.length}`);
    } else if (f.op === 'gte') {
      // date range lower bound: `col >= from` (date cast → midnight; works on timestamptz columns).
      params.push(f.values[0]);
      clauses.push(`${f.column} >= $${params.length}::date`);
    } else if (f.op === 'lt') {
      // date range upper bound, inclusive day: `col < to + 1 day`.
      params.push(f.values[0]);
      clauses.push(`${f.column} < ($${params.length}::date + 1)`);
    } else {
      params.push(f.values[0]);
      clauses.push(`${f.column} = $${params.length}`);
    }
  }
  return clauses;
}

export interface ResolvedPage {
  page: number;
  limit: number;
  offset: number;
  search: string | undefined;
  /** the apiField echoed back in the envelope's `sort`. */
  sortBy: string;
  /** the whitelisted SQL column — safe to interpolate into ORDER BY. */
  sortColumn: string;
  sortOrder: SortOrder;
}

const toInt = (v: unknown, fallback: number): number => {
  if (typeof v !== 'string' || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
};

export function resolvePage(query: Record<string, unknown>, spec: PageSpec): ResolvedPage {
  const page = Math.max(1, toInt(query['page'], 1));

  const limit = toInt(query['limit'], DEFAULT_PAGE_SIZE);
  if (limit < 1) throw AppError.badRequest('INVALID_LIMIT', { limit });
  if (limit > MAX_PAGE_SIZE) throw AppError.badRequest('LIMIT_TOO_LARGE', { limit, max: MAX_PAGE_SIZE });

  const offset = (page - 1) * limit;

  const rawSearch = query['search'];
  const search = typeof rawSearch === 'string' && rawSearch.trim() !== '' ? rawSearch.trim() : undefined;

  // Whitelist the sort field; fall back to the default for unknown/missing (robust to stale URLs).
  const reqSortBy = query['sortBy'];
  const sortBy =
    typeof reqSortBy === 'string' && Object.prototype.hasOwnProperty.call(spec.sortMap, reqSortBy)
      ? reqSortBy
      : spec.defaultSort;
  const sortColumn = spec.sortMap[sortBy] ?? spec.sortMap[spec.defaultSort] ?? spec.defaultSort;

  const rawOrder = query['sortOrder'];
  const sortOrder: SortOrder =
    rawOrder === 'desc' ? 'desc' : rawOrder === 'asc' ? 'asc' : (spec.defaultOrder ?? 'asc');

  return { page, limit, offset, search, sortBy, sortColumn, sortOrder };
}

export function buildPage<T>(
  items: T[],
  totalCount: number,
  r: ResolvedPage,
  filters: Record<string, unknown> = {},
): Paginated<T> {
  return {
    items,
    totalCount,
    page: r.page,
    pageSize: r.limit,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / r.limit),
    sort: { sortBy: r.sortBy, sortOrder: r.sortOrder },
    filters,
  };
}
