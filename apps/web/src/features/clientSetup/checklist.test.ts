import { describe, it, expect } from 'vitest';
import { deriveStepStates, sumUnitCounts, stepChipLabel, type SetupCounts } from './checklist.js';

const counts = (overrides: Partial<SetupCounts> = {}): SetupCounts => ({
  cpvLinks: 0,
  cpvUnits: 0,
  rateTypeAssignments: 0,
  rates: 0,
  commissionRates: 0,
  ...overrides,
});

describe('deriveStepStates', () => {
  it('all-zero counts: step 1 incomplete, 2-4 blocked', () => {
    expect(deriveStepStates(counts(), true)).toEqual({
      1: 'incomplete',
      2: 'blocked',
      3: 'blocked',
      4: 'blocked',
    });
  });

  it('links but no units: step 1 incomplete, step 3 blocked (units gate rates)', () => {
    const s = deriveStepStates(counts({ cpvLinks: 2, cpvUnits: 0 }), true);
    expect(s[1]).toBe('incomplete');
    expect(s[3]).toBe('blocked');
  });

  it('links + units > 0: step 1 complete, 2-4 unblocked but incomplete (own counts still 0)', () => {
    const s = deriveStepStates(counts({ cpvLinks: 2, cpvUnits: 3 }), true);
    expect(s).toEqual({ 1: 'complete', 2: 'incomplete', 3: 'incomplete', 4: 'incomplete' });
  });

  it('everything > 0: all complete', () => {
    const s = deriveStepStates(
      counts({ cpvLinks: 2, cpvUnits: 3, rateTypeAssignments: 1, rates: 4, commissionRates: 1 }),
      true,
    );
    expect(s).toEqual({ 1: 'complete', 2: 'complete', 3: 'complete', 4: 'complete' });
  });

  it('canManage=false: step 4 is skipped regardless of counts', () => {
    const s = deriveStepStates(
      counts({ cpvLinks: 2, cpvUnits: 3, rateTypeAssignments: 1, rates: 4, commissionRates: 1 }),
      false,
    );
    expect(s[4]).toBe('skipped');
    const sAllZero = deriveStepStates(counts(), false);
    expect(sAllZero[4]).toBe('skipped');
  });

  it('cpvUnits null never blocks step 1/3 — it makes them honestly incomplete, not blocked', () => {
    const s = deriveStepStates(
      counts({ cpvLinks: 5, cpvUnits: null, rateTypeAssignments: 5, rates: 0, commissionRates: 5 }),
      true,
    );
    expect(s[1]).toBe('incomplete');
    expect(s[3]).not.toBe('blocked');
    expect(s[3]).toBe('incomplete');
  });

  it('a null own-count never reads as complete', () => {
    const s = deriveStepStates(counts({ cpvLinks: 2, cpvUnits: 3, rateTypeAssignments: null }), true);
    expect(s[2]).toBe('incomplete');
  });
});

describe('stepChipLabel', () => {
  it('step 1 renders "links · units", null as "—"', () => {
    expect(stepChipLabel(1, counts({ cpvLinks: 2, cpvUnits: null }))).toBe('2 · —');
  });

  it('steps 2-4 render a single count', () => {
    const c = counts({ rateTypeAssignments: 4, rates: null, commissionRates: 0 });
    expect(stepChipLabel(2, c)).toBe('4');
    expect(stepChipLabel(3, c)).toBe('—');
    expect(stepChipLabel(4, c)).toBe('0');
  });
});

describe('sumUnitCounts', () => {
  it('sums to 0 for an empty list', () => {
    expect(sumUnitCounts([])).toBe(0);
  });

  it('sums unitCount across items', () => {
    expect(sumUnitCounts([{ unitCount: 2 }, { unitCount: 3 }])).toBe(5);
  });
});
