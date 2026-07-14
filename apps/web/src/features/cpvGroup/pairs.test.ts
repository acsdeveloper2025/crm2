import { describe, it, expect } from 'vitest';
import { pairKey, resolvePairs, retainUnits, toggleUniversalExclusive, unitOptionIds } from './pairs.js';

/** CPV matrix: product 1 → units {10, 11}; product 2 → units {11, 12}. Deliberately JAGGED. */
const cpv = new Map<number, Set<number>>([
  [1, new Set([10, 11])],
  [2, new Set([11, 12])],
]);

describe('toggleUniversalExclusive (Universal XOR concrete, ADR-0071)', () => {
  it('adds and removes concrete ids', () => {
    expect(toggleUniversalExclusive([], 1)).toEqual([1]);
    expect(toggleUniversalExclusive([1], 2)).toEqual([1, 2]);
    expect(toggleUniversalExclusive([1, 2], 1)).toEqual([2]);
  });
  it('ticking Universal clears every concrete pick', () => {
    expect(toggleUniversalExclusive([1, 2], null)).toEqual([null]);
  });
  it('ticking a concrete id clears Universal', () => {
    expect(toggleUniversalExclusive([null], 1)).toEqual([1]);
  });
  it('unticking Universal empties the axis', () => {
    expect(toggleUniversalExclusive([null], null)).toEqual([]);
  });
});

describe('unitOptionIds (the unit picker is the UNION across picked products)', () => {
  it('a Universal product offers every active unit (mirrors the single-select unitCpvScoped gate)', () => {
    expect(unitOptionIds([null], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12, 13]);
  });
  it('no product picked yet offers every active unit', () => {
    expect(unitOptionIds([], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12, 13]);
  });
  it('one concrete product offers only its CPV units', () => {
    expect(unitOptionIds([1], cpv, [10, 11, 12, 13])).toEqual([10, 11]);
  });
  it('several concrete products offer the UNION, not the intersection', () => {
    expect(unitOptionIds([1, 2], cpv, [10, 11, 12, 13])).toEqual([10, 11, 12]);
  });
  it("preserves the caller's unit ordering (sort_order from the API)", () => {
    expect(unitOptionIds([1, 2], cpv, [13, 12, 11, 10])).toEqual([12, 11, 10]);
  });
  it('a product with no CPV mapping contributes nothing', () => {
    expect(unitOptionIds([9], cpv, [10, 11, 12])).toEqual([]);
  });
});

describe('resolvePairs (the group is JAGGED, not a rectangle)', () => {
  it('intersects each product with its own CPV units and reports the drops', () => {
    // The rectangle is 2x2 = 4; CPV allows only 3 — (2,10) is not mapped.
    const { pairs, dropped } = resolvePairs([1, 2], [10, 11], cpv);
    expect(pairs).toEqual([
      { productId: 1, unitId: 10 },
      { productId: 1, unitId: 11 },
      { productId: 2, unitId: 11 },
    ]);
    expect(dropped).toEqual([{ productId: 2, unitId: 10 }]);
  });
  it('a Universal product is not CPV-constrained (no per-product mapping exists to consult)', () => {
    const { pairs, dropped } = resolvePairs([null], [10, 12], cpv);
    expect(pairs).toEqual([
      { productId: null, unitId: 10 },
      { productId: null, unitId: 12 },
    ]);
    expect(dropped).toEqual([]);
  });
  it('a Universal unit is not CPV-constrained', () => {
    const { pairs, dropped } = resolvePairs([1, 2], [null], cpv);
    expect(pairs).toEqual([
      { productId: 1, unitId: null },
      { productId: 2, unitId: null },
    ]);
    expect(dropped).toEqual([]);
  });
  it('fully Universal resolves to the single Universal slot', () => {
    expect(resolvePairs([null], [null], cpv).pairs).toEqual([{ productId: null, unitId: null }]);
  });
  it('an empty axis resolves to no pairs (a money table never defaults to Universal)', () => {
    expect(resolvePairs([], [10], cpv).pairs).toEqual([]);
    expect(resolvePairs([1], [], cpv).pairs).toEqual([]);
  });
  it('one concrete pair reproduces the single-slot case exactly', () => {
    expect(resolvePairs([1], [10], cpv).pairs).toEqual([{ productId: 1, unitId: 10 }]);
  });
});

describe("retainUnits (a product tick must not destroy the user's other picks)", () => {
  it('keeps units still offered by the new product set', () => {
    expect(retainUnits([1, 2], [10, 11], cpv, [10, 11, 12, 13])).toEqual([10, 11]);
  });
  it('drops only units no remaining product offers', () => {
    // Untick product 2 → unit 12 (only product 2 had it) must go; unit 10 stays.
    expect(retainUnits([1], [10, 12], cpv, [10, 11, 12, 13])).toEqual([10]);
  });
  it('never drops Universal', () => {
    expect(retainUnits([1], [null], cpv, [10, 11, 12, 13])).toEqual([null]);
  });
  it('keeps everything when the new product set is Universal', () => {
    expect(retainUnits([null], [10, 12], cpv, [10, 11, 12, 13])).toEqual([10, 12]);
  });
  it('adding a product never drops an existing unit (the set only widens)', () => {
    expect(retainUnits([1, 2], [10], cpv, [10, 11, 12, 13])).toEqual([10]);
  });
});

describe('pairKey', () => {
  it('distinguishes Universal from every concrete id', () => {
    expect(pairKey({ productId: null, unitId: null })).not.toBe(pairKey({ productId: 1, unitId: 1 }));
    expect(pairKey({ productId: null, unitId: 1 })).not.toBe(pairKey({ productId: 1, unitId: null }));
  });
  it('is stable for equal pairs', () => {
    expect(pairKey({ productId: 1, unitId: 10 })).toBe(pairKey({ productId: 1, unitId: 10 }));
  });
});
