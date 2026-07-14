import { describe, it, expect } from 'vitest';
import {
  availableRateTypesPath,
  createFriendlyError,
  existingRateLabel,
  groupOutcome,
  isHardBlocked,
  isPincodeNotFound,
  locationGroupStates,
  modeHasDownstream,
  dimParam,
  ASSIGN_RATE_TYPES_PATH,
  CLEAR_FIELDS_LABEL,
  LOCATIONS_ADMIN_PATH,
  MODE_LOCKED_HELPER,
  NO_RATE_TYPES_FOR_COMBO,
  PICK_COMBO_FIRST,
  PINCODE_NOT_FOUND,
  UNIVERSAL,
} from './RateCreatePage.js';

/** Minimal existing-rate row for the slot helpers. */
const row = (
  productId: number | null,
  unitId: number | null,
  locationId: number | null,
  clientRateType: string | null,
  amount: number,
) => ({ productId, verificationUnitId: unitId, locationId, clientRateType, amount });

describe('dimParam (explicit Universal sentinel, ADR-0071)', () => {
  it('maps null to the UNIVERSAL sentinel and ids to strings', () => {
    expect(dimParam(null)).toBe(UNIVERSAL);
    expect(dimParam(7)).toBe('7');
  });
});

describe('existingRateLabel (compact chip label)', () => {
  it('labels compactly, null type as —', () => {
    expect(
      existingRateLabel([
        { clientRateType: 'LOCAL', amount: 500 },
        { clientRateType: null, amount: 900 },
      ]),
    ).toBe('LOCAL ₹500 · — ₹900');
  });
});

/**
 * UX: the create page's known 4xx codes in plain English; unknown codes fall through to the raw
 * code — never silently swallowed. RATE_EXISTS comes from the shared record-page map.
 */
describe('createFriendlyError (rates create page)', () => {
  it('maps the bulk-guard codes', () => {
    expect(createFriendlyError('HAS_OTHER_RATE_TYPE')).toContain('one location holds one rate type');
    expect(createFriendlyError('OFFICE_NOT_BULKABLE')).toContain('single rate');
    expect(createFriendlyError('INVALID_RATE_TYPE')).toContain('single rate');
    expect(createFriendlyError('VALIDATION')).toContain('capped at 500');
  });

  it('keeps the shared RATE_EXISTS copy and falls through on unknown codes', () => {
    expect(createFriendlyError('RATE_EXISTS')).toContain('already overlaps');
    expect(createFriendlyError('STALE_UPDATE')).toBeNull();
    expect(createFriendlyError('')).toBeNull();
  });
});

/**
 * Owner fix 2026-07-08 (moved here with the create branch): the rate-type picker stays
 * assignment-gated even when product and/or unit is Universal — a Universal dim OMITS its query
 * param entirely instead of falling back to the full, ungated catalog.
 */
describe('availableRateTypesPath (rate-type picker)', () => {
  it('both dims concrete → both ids on the query', () => {
    expect(availableRateTypesPath('7', '3', '9')).toBe(
      '/api/v2/rate-types/available?clientId=7&productId=3&verificationUnitId=9',
    );
  });

  it('a Universal dim omits its param (never falls back to /rate-types/options)', () => {
    expect(availableRateTypesPath('7', UNIVERSAL, '9')).toBe(
      '/api/v2/rate-types/available?clientId=7&verificationUnitId=9',
    );
    expect(availableRateTypesPath('7', '3', UNIVERSAL)).toBe(
      '/api/v2/rate-types/available?clientId=7&productId=3',
    );
    expect(availableRateTypesPath('7', UNIVERSAL, UNIVERSAL)).toBe('/api/v2/rate-types/available?clientId=7');
  });

  it('pins the rate-type gating copy + assign link', () => {
    expect(PICK_COMBO_FIRST).toBe('Pick client, product & unit first');
    expect(NO_RATE_TYPES_FOR_COMBO).toBe('No rate types assigned for this combination');
    expect(ASSIGN_RATE_TYPES_PATH).toBe('/admin/rate-type-assignments/new');
  });
});

/**
 * UX-7 (moved with the create branch): a complete pincode whose areas query succeeded with zero rows
 * gets an explicit message + link; gate on isSuccess so there's no flash while in flight.
 */
describe('isPincodeNotFound (rates create page)', () => {
  it('only fires for a complete pincode with a successful empty result', () => {
    expect(isPincodeNotFound({ pincode: '4000', isSuccess: true, count: 0 })).toBe(false);
    expect(isPincodeNotFound({ pincode: '400001', isSuccess: false, count: 0 })).toBe(false);
    expect(isPincodeNotFound({ pincode: '400001', isSuccess: true, count: 3 })).toBe(false);
    expect(isPincodeNotFound({ pincode: '999999', isSuccess: true, count: 0 })).toBe(true);
  });

  it('pins the copy + path', () => {
    expect(PINCODE_NOT_FOUND).toBe('Pincode not found — add it in Location Management first');
    expect(LOCATIONS_ADMIN_PATH).toBe('/admin/locations');
  });
});

/**
 * UX-9 (adapted): switching Field/Office resets rate type + locations, so the toggle disables itself
 * once any of them is set — with the inline Clear action as the recovery path.
 */
describe('modeHasDownstream (Field/Office toggle guard)', () => {
  const base = { clientRateType: '', pincodeCount: 0, selectedCount: 0, pairCount: 0 };

  it('is false when nothing downstream is set', () => {
    expect(modeHasDownstream(base)).toBe(false);
  });
  it('is true when a rate type, a pincode group, or a selection exists', () => {
    expect(modeHasDownstream({ ...base, clientRateType: 'LOCAL' })).toBe(true);
    expect(modeHasDownstream({ ...base, pincodeCount: 1 })).toBe(true);
    expect(modeHasDownstream({ ...base, selectedCount: 1 })).toBe(true);
  });
  it('a single pair leaves the toggle free — office rates are single-slot too', () => {
    expect(modeHasDownstream({ ...base, pairCount: 1 })).toBe(false);
  });
  it('a GROUP locks the toggle: office does one flat create and would silently drop the group', () => {
    expect(modeHasDownstream({ ...base, pairCount: 2 })).toBe(true);
  });
  it('pins the helper + action copy', () => {
    expect(MODE_LOCKED_HELPER).toBe('Clear rate-type/location fields to switch mode');
    expect(CLEAR_FIELDS_LABEL).toBe('Clear fields');
  });
});

describe('locationGroupStates (per-location state across a CPV group)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const pairs = [P1U1, P2U1];
  // LOCAL at (P1,U1,L5); OGL at (P2,U1,L5). Same location, different slots.
  const items = [row(1, 10, 5, 'LOCAL', 175), row(2, 10, 5, 'OGL', 220)];

  it('scopes each pair to its OWN slot — a different product at the same location is a different slot', () => {
    const st = locationGroupStates(items, pairs, 'LOCAL', 175);
    // (P1,U1,L5) already has LOCAL → EXISTS-skip. (P2,U1,L5) has OGL → blocked for a LOCAL save.
    expect(st.get(5)?.exists.map((h) => h.pair)).toEqual([P1U1]);
    expect(st.get(5)?.blocked.map((h) => h.pair)).toEqual([P2U1]);
    expect(st.get(5)?.totalPairs).toBe(2);
  });

  it('does not leak a rate from one pair into another pair’s state', () => {
    // Regression: folding by bare locationId would merge P1's LOCAL into P2's state and vice-versa.
    const st = locationGroupStates(items, [P2U1], 'OGL', 220);
    expect(st.get(5)?.exists.map((h) => h.pair)).toEqual([P2U1]);
    expect(st.get(5)?.blocked).toEqual([]);
  });

  it('ignores rates at locations and pairs outside the group', () => {
    const other = [row(9, 99, 5, 'OGL', 1), row(1, 10, 6, 'OGL', 1)];
    const st = locationGroupStates(other, [P1U1], 'LOCAL', 500);
    expect(st.get(5)).toBeUndefined(); // pair (9,99) is not in the group
    expect(st.get(6)?.blocked.map((h) => h.pair)).toEqual([P1U1]); // location 6 is
  });

  it('a Universal pair matches only Universal rates (null === null)', () => {
    const uni = [row(null, null, 5, 'OGL', 300)];
    const st = locationGroupStates(uni, [{ productId: null, unitId: null }], 'LOCAL', 500);
    expect(st.get(5)?.blocked).toHaveLength(1);
    expect(locationGroupStates(uni, [P1U1], 'LOCAL', 500).get(5)).toBeUndefined();
  });

  it('never blocks on a typeless row, and never before a type is chosen', () => {
    const typeless = [row(1, 10, 5, null, 100)];
    expect(locationGroupStates(typeless, [P1U1], 'LOCAL', 500).get(5)?.blocked).toEqual([]);
    expect(locationGroupStates(items, pairs, '', 500).get(5)?.blocked).toEqual([]);
  });

  it('ignores office (null location) rows — a group only fans over real locations', () => {
    expect(locationGroupStates([row(1, 10, null, 'OGL', 1)], [P1U1], 'LOCAL', 1).size).toBe(0);
  });
});

describe('locationGroupStates — repriced (the skip that silently discards a price change)', () => {
  const P1U1 = { productId: 1, unitId: 10 };
  const P2U1 = { productId: 2, unitId: 10 };
  const pairs = [P1U1, P2U1];
  // Both pairs already carry LOCAL at location 5, at DIFFERENT amounts.
  const items = [row(1, 10, 5, 'LOCAL', 175), row(2, 10, 5, 'LOCAL', 175)];

  it('re-saving the SAME amount is a benign skip — not repriced', () => {
    const st = locationGroupStates(items, pairs, 'LOCAL', 175);
    expect(st.get(5)?.exists).toHaveLength(2);
    expect(st.get(5)?.repriced).toEqual([]);
  });

  it('a DIFFERENT amount is repriced — amount is not in the overlap key, so ₹500 is discarded', () => {
    const st = locationGroupStates(items, pairs, 'LOCAL', 500);
    expect(st.get(5)?.exists).toHaveLength(2); // still skipped…
    expect(st.get(5)?.repriced.map((h) => h.pair)).toEqual([P1U1, P2U1]); // …and the ₹500 is lost
  });

  it('repriced is a SUBSET of exists — never blocked, never a new row', () => {
    const mixed = [row(1, 10, 5, 'LOCAL', 175), row(2, 10, 5, 'LOCAL', 500)];
    const st = locationGroupStates(mixed, pairs, 'LOCAL', 500);
    expect(st.get(5)?.exists).toHaveLength(2);
    expect(st.get(5)?.repriced.map((h) => h.pair)).toEqual([P1U1]); // only the ₹175 one
  });

  it('carries the existing amount so the page can name it ("already LOCAL ₹175")', () => {
    const st = locationGroupStates(items, [P1U1], 'LOCAL', 500);
    expect(st.get(5)?.repriced[0]?.hints).toEqual([{ clientRateType: 'LOCAL', amount: 175 }]);
  });

  it('claims nothing before an amount is entered', () => {
    expect(locationGroupStates(items, pairs, 'LOCAL', null).get(5)?.repriced).toEqual([]);
  });

  it('a blocked (different-type) pair is never repriced — it errors, it does not skip', () => {
    const st = locationGroupStates([row(1, 10, 5, 'OGL', 175)], [P1U1], 'LOCAL', 500);
    expect(st.get(5)?.blocked).toHaveLength(1);
    expect(st.get(5)?.repriced).toEqual([]);
  });
});

describe('isHardBlocked (red+disabled only when EVERY pair is blocked)', () => {
  const hit = (productId: number) => ({ pair: { productId, unitId: 10 }, hints: [] });

  it('blocks when every pair is blocked', () => {
    expect(isHardBlocked({ totalPairs: 2, blocked: [hit(1), hit(2)], exists: [], repriced: [] })).toBe(true);
  });
  it('does NOT block when only some pairs are blocked — those become per-row errors', () => {
    expect(isHardBlocked({ totalPairs: 2, blocked: [hit(1)], exists: [], repriced: [] })).toBe(false);
  });
  it('a ONE-pair group reduces to today’s single-slot behaviour exactly', () => {
    expect(isHardBlocked({ totalPairs: 1, blocked: [hit(1)], exists: [], repriced: [] })).toBe(true);
    expect(isHardBlocked({ totalPairs: 1, blocked: [], exists: [hit(1)], repriced: [] })).toBe(false);
  });
  it('is false for an untouched location', () => {
    expect(isHardBlocked(undefined)).toBe(false);
    expect(isHardBlocked({ totalPairs: 2, blocked: [], exists: [], repriced: [] })).toBe(false);
  });
});

describe('groupOutcome (the honest pre-save strip)', () => {
  const hit = (productId: number) => ({ pair: { productId, unitId: 10 }, hints: [] });

  it('counts created / skipped / blocked across pairs × locations', () => {
    const states = new Map([
      // 3 pairs at L5: 1 blocked, 1 skip, 1 new.
      [5, { totalPairs: 3, blocked: [hit(1)], exists: [hit(2)], repriced: [] }],
      [6, { totalPairs: 3, blocked: [], exists: [], repriced: [] }], // untouched: 3 new
    ]);
    expect(groupOutcome(states, [5, 6], 3)).toEqual({ created: 4, skipped: 1, blocked: 1, repriced: 0 });
  });
  it('a location with no existing rates contributes one row per pair', () => {
    expect(groupOutcome(new Map(), [5, 6], 4)).toEqual({ created: 8, skipped: 0, blocked: 0, repriced: 0 });
  });
  it('counts only the SELECTED locations', () => {
    const states = new Map([[5, { totalPairs: 1, blocked: [hit(1)], exists: [], repriced: [] }]]);
    expect(groupOutcome(states, [6], 1)).toEqual({ created: 1, skipped: 0, blocked: 0, repriced: 0 });
  });
  it('is zero across the board with nothing selected', () => {
    expect(groupOutcome(new Map(), [], 3)).toEqual({ created: 0, skipped: 0, blocked: 0, repriced: 0 });
  });

  // THE LIVE PROD BUG this fixes. Today the page uses `count = selected.size` for the sticky bar and
  // the Save label, so ticking 5 already-priced areas reads "Create 5 rates" and creates ZERO.
  it('an all-skip selection reports 0 created, never the tick count', () => {
    const states = new Map([
      [5, { totalPairs: 1, blocked: [], exists: [hit(1)], repriced: [] }],
      [6, { totalPairs: 1, blocked: [], exists: [hit(1)], repriced: [] }],
    ]);
    expect(groupOutcome(states, [5, 6], 1)).toEqual({ created: 0, skipped: 2, blocked: 0, repriced: 0 });
  });
  it('surfaces repriced separately — it is a subset of skipped, never of created', () => {
    const states = new Map([
      [5, { totalPairs: 2, blocked: [], exists: [hit(1), hit(2)], repriced: [hit(1)] }],
    ]);
    expect(groupOutcome(states, [5], 2)).toEqual({ created: 0, skipped: 2, blocked: 0, repriced: 1 });
  });
});
