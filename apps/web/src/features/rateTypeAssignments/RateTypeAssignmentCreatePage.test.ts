import { describe, it, expect } from 'vitest';
import {
  NO_CPV_MAPPING,
  CPV_ADMIN_PATH,
  rtaFriendlyError,
  assignedRateTypeIds,
  coveredRateTypeIds,
  submitPlan,
  groupSubmitPlan,
  assignedPairCount,
  coveredPairCount,
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

describe('groupSubmitPlan (a group is N slots)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const a = (productId: number | null, unitId: number | null, rateTypeId: number) => ({
    productId,
    verificationUnitId: unitId,
    rateTypeId,
  });

  it('plans one call per pair, each with the ticked types', () => {
    const plan = groupSubmitPlan([P1U1, P2U1], [100, 200], []);
    expect(plan.mode).toBe('bulk');
    expect(plan.willCreate).toBe(4); // 2 pairs x 2 types
    expect(plan.perPair).toEqual([
      { pair: P1U1, ids: [100, 200], willCreate: 2 },
      { pair: P2U1, ids: [100, 200], willCreate: 2 },
    ]);
  });

  it('counts willCreate PER PAIR — an existing assignment at one pair doesn’t mask another', () => {
    const plan = groupSubmitPlan([P1U1, P2U1], [100], [a(1, 10, 100)]);
    expect(plan.willCreate).toBe(1); // only (P2,U1) is new
    expect(plan.perPair[0]?.willCreate).toBe(0);
    expect(plan.perPair[1]?.willCreate).toBe(1);
    expect(plan.perPair[0]?.ids).toEqual([100]); // amber ids still submit → reported as Skipped
  });

  it('a GROUP with one ticked type is NOT single — the singular endpoint writes ONE row', () => {
    // Regression: mode === 'single' on ids.length === 1 alone silently wrote 1 row for an N-pair group.
    const plan = groupSubmitPlan([P1U1, P2U1], [100], []);
    expect(plan.mode).toBe('bulk');
  });

  it('exactly one pair AND one type stays single (today’s behaviour)', () => {
    expect(groupSubmitPlan([P1U1], [100], []).mode).toBe('single');
  });

  it('is none when nothing new would be created anywhere', () => {
    expect(groupSubmitPlan([P1U1, P2U1], [100], [a(1, 10, 100), a(2, 10, 100)]).mode).toBe('none');
    expect(groupSubmitPlan([], [100], []).mode).toBe('none');
    expect(groupSubmitPlan([P1U1], [], []).mode).toBe('none');
  });

  it('dedupes ticked ids', () => {
    expect(groupSubmitPlan([P1U1], [100, 100], []).perPair[0]?.ids).toEqual([100]);
  });

  it('a Universal pair matches only Universal assignments', () => {
    const uni = { productId: null, unitId: null };
    expect(groupSubmitPlan([uni], [100], [a(null, null, 100)]).mode).toBe('none');
    expect(groupSubmitPlan([uni], [100], [a(1, 10, 100)]).willCreate).toBe(1);
  });
});

describe('coveredPairCount / assignedPairCount (group chip hints)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const a = (productId: number | null, unitId: number | null, rateTypeId: number) => ({
    productId,
    verificationUnitId: unitId,
    rateTypeId,
  });

  it('counts pairs already carrying the type at their exact slot', () => {
    expect(assignedPairCount([a(1, 10, 100)], [P1U1, P2U1], 100)).toBe(1);
  });
  it('counts pairs where a broader Universal parent already covers the type', () => {
    // A Universal (null, null) assignment resolves at every pair (UNION resolver, ADR-0067).
    expect(coveredPairCount([a(null, null, 100)], [P1U1, P2U1], 100)).toBe(2);
  });
  it('a specific assignment does not bubble up to a Universal pair', () => {
    expect(coveredPairCount([a(1, 10, 100)], [{ productId: null, unitId: null }], 100)).toBe(0);
  });
  it('is zero for an unrelated rate type', () => {
    expect(coveredPairCount([a(null, null, 100)], [P1U1], 999)).toBe(0);
  });
});
