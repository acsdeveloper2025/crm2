import { describe, it, expect } from 'vitest';
import { paginate, UNIT_PAGE_SIZE } from './CpvPage.js';

/**
 * UX-6: the enabled-units sub-table paginates client-side at UNIT_PAGE_SIZE (20) — the checkbox
 * multi-select + "Enable selected (n)" flow itself is exercised via the browser-verify pass (no RTL
 * in this repo); the pure slicing logic gets a direct unit test (export-style, mirrors the sibling
 * `RateManagementPage.test.ts` / `RateTypeAssignmentCreatePage.test.ts` convention).
 */
describe('paginate (CPV unit sub-table, UX-6)', () => {
  it('page size is 20', () => {
    expect(UNIT_PAGE_SIZE).toBe(20);
  });

  it('returns every item on page 1 when there are fewer than pageSize', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const { pageItems, totalPages } = paginate(items, 1, 20);
    expect(pageItems).toEqual(items);
    expect(totalPages).toBe(1);
  });

  it('splits across pages once items exceed pageSize', () => {
    const items = Array.from({ length: 21 }, (_, i) => i);
    const page1 = paginate(items, 1, 20);
    expect(page1.pageItems).toHaveLength(20);
    expect(page1.totalPages).toBe(2);
    const page2 = paginate(items, 2, 20);
    expect(page2.pageItems).toEqual([20]);
  });

  it('clamps an out-of-range page into bounds (never renders empty after the last page shrinks)', () => {
    const items = Array.from({ length: 21 }, (_, i) => i);
    const { pageItems } = paginate(items, 99, 20);
    expect(pageItems).toEqual([20]); // clamped to the real last page (2)
  });

  it('empty list is one (empty) page, not zero', () => {
    const { pageItems, totalPages } = paginate([], 1, 20);
    expect(pageItems).toEqual([]);
    expect(totalPages).toBe(1);
  });
});
