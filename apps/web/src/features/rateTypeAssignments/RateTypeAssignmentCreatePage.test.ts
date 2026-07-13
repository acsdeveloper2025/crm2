import { describe, it, expect } from 'vitest';
import {
  NO_CPV_MAPPING,
  CPV_ADMIN_PATH,
  rtaFriendlyError,
  assignedRateTypeIds,
  coveredRateTypeIds,
  submitPlan,
} from './RateTypeAssignmentCreatePage.js';

/**
 * UX-3: when a concrete client + product is picked and /cpv-units/available returns [], the admin
 * gets an explicit "no CPV mapping" warning + a link to the CPV admin. Pin the copy + href so they
 * can't silently drift.
 */
describe('CPV-missing warning copy', () => {
  it('names the missing-mapping state explicitly', () => {
    expect(NO_CPV_MAPPING).toBe('This client + product has no CPV mapping yet');
  });

  it('links straight to the CPV admin', () => {
    expect(CPV_ADMIN_PATH).toBe('/admin/cpv');
  });
});

describe('rtaFriendlyError', () => {
  it('maps known codes to plain English', () => {
    expect(rtaFriendlyError('INVALID_ASSIGNMENT_REF')).toMatch(/unknown client/i);
    expect(rtaFriendlyError('VALIDATION')).toMatch(/at least one rate type/i);
  });
  it('returns null for unknown codes (caller falls back to the raw code)', () => {
    expect(rtaFriendlyError('SOMETHING_ELSE')).toBeNull();
  });
});

describe('assignedRateTypeIds (amber-hint slot match)', () => {
  const rows = [
    { productId: 10, verificationUnitId: 20, rateTypeId: 1 }, // specific slot
    { productId: null, verificationUnitId: null, rateTypeId: 2 }, // Universal slot
    { productId: 10, verificationUnitId: null, rateTypeId: 3 }, // product-only
  ];

  it('matches the exact specific slot only', () => {
    expect([...assignedRateTypeIds(rows, 10, 20)]).toEqual([1]);
  });
  it('is null-aware: Universal slot matches only Universal rows', () => {
    expect([...assignedRateTypeIds(rows, null, null)]).toEqual([2]);
  });
  it('does not conflate a product-only slot with a fully-specified one', () => {
    expect([...assignedRateTypeIds(rows, 10, null)]).toEqual([3]);
  });
});

describe('coveredRateTypeIds (resolver-mirror: Universal parents cover specific slots)', () => {
  const rows = [
    { productId: null, verificationUnitId: null, rateTypeId: 1 }, // Universal (∅,∅)
    { productId: 10, verificationUnitId: null, rateTypeId: 2 }, // product-only, Universal unit
    { productId: null, verificationUnitId: 5, rateTypeId: 3 }, // unit-only, Universal product
    { productId: 10, verificationUnitId: 5, rateTypeId: 4 }, // fully specific
    { productId: 99, verificationUnitId: 5, rateTypeId: 5 }, // different product
  ];

  it('a specific slot inherits every broader parent (this is the reported scenario)', () => {
    // Slot (10,5): the Universal, both partial-Universal, and the exact rows all resolve here; the
    // (99,5) row does not. Mirrors `available()` `(product_id IS NULL OR =P) AND (unit_id IS NULL OR =U)`.
    expect([...coveredRateTypeIds(rows, 10, 5)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('is directional: a Universal slot does NOT inherit specific assignments', () => {
    // Slot (∅,∅) resolves only rows that are themselves Universal on both dims — specifics never
    // bubble up. So a specific (10,5) assignment is invisible at the Universal slot.
    expect([...coveredRateTypeIds(rows, null, null)]).toEqual([1]);
  });

  it('a different specific product only inherits the Universal-on-that-dim parents', () => {
    expect([...coveredRateTypeIds(rows, 20, 5)].sort()).toEqual([1, 3]);
  });

  it('coveredByParent = covered − exact-assigned = the "redundant here" set', () => {
    // At (10,5): assigned (exact) = {4}; covered = {1,2,3,4}; so covered-but-not-exact = {1,2,3}.
    const assigned = assignedRateTypeIds(rows, 10, 5);
    const coveredByParent = [...coveredRateTypeIds(rows, 10, 5)].filter((id) => !assigned.has(id));
    expect(coveredByParent.sort()).toEqual([1, 2, 3]);
  });
});

describe('submitPlan (single-vs-bulk decision + willCreate)', () => {
  it('one new type → single (POST /, navigate back)', () => {
    expect(submitPlan([1], new Set())).toEqual({ mode: 'single', ids: [1], willCreate: 1 });
  });
  it('two+ types → bulk, and amber ids stay in the payload so the result can report them Skipped', () => {
    expect(submitPlan([1, 2], new Set([2]))).toEqual({ mode: 'bulk', ids: [1, 2], willCreate: 1 });
  });
  it('a lone already-assigned type → none (submit blocked; no false "created")', () => {
    expect(submitPlan([2], new Set([2]))).toEqual({ mode: 'none', ids: [2], willCreate: 0 });
  });
  it('all-amber multi → none (no empty "Create 0" round-trip)', () => {
    expect(submitPlan([1, 2], new Set([1, 2]))).toMatchObject({ mode: 'none', willCreate: 0 });
  });
  it('an inactive combo is NOT amber, so it still counts toward a real create', () => {
    // rate type 9 not in the (active-only) assigned set → willCreate counts it.
    expect(submitPlan([9], new Set([1, 2]))).toEqual({ mode: 'single', ids: [9], willCreate: 1 });
  });
  it('dedupes a repeated id', () => {
    expect(submitPlan([1, 1], new Set())).toEqual({ mode: 'single', ids: [1], willCreate: 1 });
  });
});
