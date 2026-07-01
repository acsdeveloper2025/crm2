import { describe, it, expect } from 'vitest';
import {
  resolvePage,
  resolveFilters,
  filterClauses,
  buildPage,
  likeContains,
  type PageSpec,
} from '../pagination.js';
import { AppError } from '../errors.js';

const SPEC: PageSpec = {
  sortMap: { name: 'name', createdAt: 'created_at' },
  defaultSort: 'name',
  defaultOrder: 'asc',
};

const FILTER_SPEC: PageSpec = {
  sortMap: { name: 'name' },
  filterMap: {
    code: { column: 'code', kind: 'text' },
    status: { column: 'is_active', kind: 'enum', values: ['true', 'false'] },
  },
  defaultSort: 'name',
};

describe('resolvePage', () => {
  it('defaults: page 1, limit 25, default sort, no search', () => {
    const r = resolvePage({}, SPEC);
    expect(r).toMatchObject({
      page: 1,
      limit: 25,
      offset: 0,
      search: undefined,
      sortBy: 'name',
      sortColumn: 'name',
      sortOrder: 'asc',
    });
  });

  it('computes offset from page/limit', () => {
    expect(resolvePage({ page: '3', limit: '50' }, SPEC).offset).toBe(100);
  });

  it('whitelists sortBy → resolves the SQL column; unknown falls back to default', () => {
    expect(resolvePage({ sortBy: 'createdAt' }, SPEC).sortColumn).toBe('created_at');
    const injected = resolvePage({ sortBy: 'name; DROP TABLE x' }, SPEC);
    expect(injected.sortBy).toBe('name');
    expect(injected.sortColumn).toBe('name');
  });

  it('honours sortOrder asc/desc; anything else → the spec default', () => {
    expect(resolvePage({ sortOrder: 'desc' }, SPEC).sortOrder).toBe('desc');
    expect(resolvePage({ sortOrder: 'sideways' }, SPEC).sortOrder).toBe('asc');
  });

  it('trims search; blank becomes undefined', () => {
    expect(resolvePage({ search: '  hdfc ' }, SPEC).search).toBe('hdfc');
    expect(resolvePage({ search: '   ' }, SPEC).search).toBeUndefined();
  });

  it('rejects limit > 500 (LIMIT_TOO_LARGE) and limit < 1 (INVALID_LIMIT)', () => {
    expect(() => resolvePage({ limit: '501' }, SPEC)).toThrow(AppError);
    expect(() => resolvePage({ limit: '0' }, SPEC)).toThrow(AppError);
    try {
      resolvePage({ limit: '501' }, SPEC);
    } catch (e) {
      expect((e as AppError).code).toBe('LIMIT_TOO_LARGE');
    }
  });

  it('clamps page to >= 1', () => {
    expect(resolvePage({ page: '0' }, SPEC).page).toBe(1);
    expect(resolvePage({ page: '-5' }, SPEC).page).toBe(1);
  });

  // INPUT_VALIDATION-02 (docs/audit/04-input-validation.md): page had no upper bound.
  it('rejects an absurdly large page (PAGE_TOO_LARGE)', () => {
    expect(() => resolvePage({ page: '999999999' }, SPEC)).toThrow(AppError);
    try {
      resolvePage({ page: '999999999' }, SPEC);
    } catch (e) {
      expect((e as AppError).code).toBe('PAGE_TOO_LARGE');
    }
  });

  it('accepts a page right at the boundary', () => {
    expect(resolvePage({ page: '1000000' }, SPEC).page).toBe(1_000_000);
  });
});

describe('resolveFilters', () => {
  it('no filterMap → no filters', () => {
    expect(resolveFilters({ f_code: 'x' }, SPEC)).toEqual([]);
  });

  it('text filter → ILIKE op against the whitelisted column', () => {
    expect(resolveFilters({ f_code: ' HD ' }, FILTER_SPEC)).toEqual([
      { field: 'code', column: 'code', op: 'ilike', values: ['HD'] },
    ]);
  });

  it('enum filter → eq op only for an allowed value; out-of-set is dropped', () => {
    expect(resolveFilters({ f_status: 'true' }, FILTER_SPEC)).toEqual([
      { field: 'status', column: 'is_active', op: 'eq', values: ['true'] },
    ]);
    expect(resolveFilters({ f_status: 'maybe' }, FILTER_SPEC)).toEqual([]);
  });

  it('enum multi-select (comma) → in op; keeps only allowed values, de-duped (§7)', () => {
    expect(resolveFilters({ f_status: 'true,false' }, FILTER_SPEC)).toEqual([
      { field: 'status', column: 'is_active', op: 'in', values: ['true', 'false'] },
    ]);
    // mixed valid+invalid → only valid survive; one valid collapses to eq
    expect(resolveFilters({ f_status: 'true,maybe,true' }, FILTER_SPEC)).toEqual([
      { field: 'status', column: 'is_active', op: 'eq', values: ['true'] },
    ]);
  });

  it('unknown / unprefixed / blank params never produce a filter (no injection surface)', () => {
    expect(resolveFilters({ f_dropTable: "x'; DROP TABLE clients --" }, FILTER_SPEC)).toEqual([]);
    expect(resolveFilters({ code: 'x' }, FILTER_SPEC)).toEqual([]); // missing f_ prefix
    expect(resolveFilters({ f_code: '   ' }, FILTER_SPEC)).toEqual([]); // blank trimmed
  });

  it('combines multiple whitelisted filters (multi-column AND, §8)', () => {
    expect(resolveFilters({ f_code: 'a', f_status: 'false' }, FILTER_SPEC)).toEqual([
      { field: 'code', column: 'code', op: 'ilike', values: ['a'] },
      { field: 'status', column: 'is_active', op: 'eq', values: ['false'] },
    ]);
  });

  // ── date-range filters (kind:'date') read f_<field>_from / f_<field>_to ──
  const DATE_SPEC: PageSpec = {
    sortMap: { name: 'name' },
    filterMap: { createdAt: { column: 'created_at', kind: 'date' } },
    defaultSort: 'name',
  };

  it('parses a date range into gte (from) + lt (to) on the whitelisted column', () => {
    expect(
      resolveFilters({ f_createdAt_from: '2026-06-01', f_createdAt_to: '2026-06-07' }, DATE_SPEC),
    ).toEqual([
      { field: 'createdAt_from', column: 'created_at', op: 'gte', values: ['2026-06-01'] },
      { field: 'createdAt_to', column: 'created_at', op: 'lt', values: ['2026-06-07'] },
    ]);
  });

  it('accepts an open-ended range (only one bound)', () => {
    expect(resolveFilters({ f_createdAt_from: '2026-06-01' }, DATE_SPEC)).toEqual([
      { field: 'createdAt_from', column: 'created_at', op: 'gte', values: ['2026-06-01'] },
    ]);
  });

  it('drops non-ISO / malformed date values (no SQL exposure)', () => {
    expect(resolveFilters({ f_createdAt_from: "2026-06-01'; DROP" }, DATE_SPEC)).toEqual([]);
    expect(resolveFilters({ f_createdAt_from: '06/01/2026' }, DATE_SPEC)).toEqual([]);
    expect(resolveFilters({ f_createdAt_to: '2026-13-40' }, DATE_SPEC)).toEqual([]);
  });
});

describe('filterClauses', () => {
  it('builds parameterized fragments and binds values (ilike/eq/in)', () => {
    const params: unknown[] = ['existing'];
    const clauses = filterClauses(
      [
        { field: 'code', column: 'code', op: 'ilike', values: ['hd'] },
        { field: 'status', column: 'is_active', op: 'eq', values: ['true'] },
        { field: 'kind', column: 'kind', op: 'in', values: ['A', 'B'] },
      ],
      params,
    );
    expect(clauses).toEqual(['code ILIKE $2', 'is_active = $3', 'kind = ANY($4)']);
    expect(params).toEqual(['existing', '%hd%', 'true', ['A', 'B']]);
  });

  it('builds a half-open date-range window: gte → >= ::date, lt → < (::date + 1)', () => {
    const params: unknown[] = [];
    const clauses = filterClauses(
      [
        { field: 'createdAt_from', column: 'created_at', op: 'gte', values: ['2026-06-01'] },
        { field: 'createdAt_to', column: 'created_at', op: 'lt', values: ['2026-06-07'] },
      ],
      params,
    );
    expect(clauses).toEqual(['created_at >= $1::date', 'created_at < ($2::date + 1)']);
    expect(params).toEqual(['2026-06-01', '2026-06-07']);
  });
});

describe('likeContains', () => {
  it('wraps a plain value as a contains-pattern unchanged', () => {
    expect(likeContains('hd')).toBe('%hd%');
  });

  it('escapes LIKE wildcards so % and _ match literally (D1)', () => {
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('a_b')).toBe('%a\\_b%');
  });

  it('escapes the backslash escape-char itself first', () => {
    expect(likeContains('a\\b')).toBe('%a\\\\b%');
  });
});

describe('filterClauses', () => {
  it('escapes ilike wildcards in the bound value (D1)', () => {
    const params: unknown[] = [];
    filterClauses([{ field: 'code', column: 'code', op: 'ilike', values: ['10_%'] }], params);
    expect(params).toEqual(['%10\\_\\%%']);
  });
});

describe('buildPage', () => {
  it('assembles the §4 envelope; totalPages = ceil(total/limit)', () => {
    const r = resolvePage({ page: '2', limit: '25' }, SPEC);
    const env = buildPage([{ id: 1 }], 51, r, { active: true });
    expect(env).toEqual({
      items: [{ id: 1 }],
      totalCount: 51,
      page: 2,
      pageSize: 25,
      totalPages: 3,
      sort: { sortBy: 'name', sortOrder: 'asc' },
      filters: { active: true },
    });
  });

  it('empty result → totalPages 0', () => {
    expect(buildPage([], 0, resolvePage({}, SPEC)).totalPages).toBe(0);
  });
});
