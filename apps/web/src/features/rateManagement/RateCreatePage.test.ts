import { describe, it, expect } from 'vitest';
import {
  availableRateTypesPath,
  blockedLocations,
  createFriendlyError,
  existingByLocation,
  existingRateLabel,
  isPincodeNotFound,
  modeHasDownstream,
  slotRates,
  toDim,
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

describe('toDim (explicit Universal sentinel, ADR-0071)', () => {
  it('maps the UNIVERSAL sentinel to null and ids to numbers', () => {
    expect(toDim(UNIVERSAL)).toBeNull();
    expect(toDim('7')).toBe(7);
  });
});

/**
 * The one-type rule and the EXISTS skip are SLOT-scoped: same client + product + unit, null-aware
 * (Universal only matches Universal — mirroring the DB key's COALESCE sentinels). Rates at other
 * products/units must not block or hint.
 */
describe('slotRates (slot-scoped existing rates)', () => {
  const items = [
    row(3, 9, 101, 'LOCAL', 500), // the slot
    row(4, 9, 101, 'OGL', 650), // other product — NOT the slot
    row(null, 9, 101, 'OGL', 700), // Universal product — NOT the slot (specific ≠ Universal)
    row(3, null, 101, 'OGL', 800), // Universal unit — NOT the slot
  ];

  it('matches only the exact product+unit pair', () => {
    expect(slotRates(items, 3, 9)).toEqual([items[0]]);
  });

  it('a Universal dim only matches Universal (null === null)', () => {
    expect(slotRates(items, null, 9)).toEqual([items[2]]);
  });
});

describe('existingByLocation + existingRateLabel (chip hints)', () => {
  it('folds slot rates into locationId → hints (null key = office rows)', () => {
    const map = existingByLocation([row(3, 9, 101, 'LOCAL', 500), row(3, 9, null, null, 900)]);
    expect(map.get(101)).toEqual([{ clientRateType: 'LOCAL', amount: 500 }]);
    expect(map.get(null)).toEqual([{ clientRateType: null, amount: 900 }]);
  });

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
 * Owner rule (2026-07-11): one (client, product, unit, location) slot holds ONE rate type — a
 * location whose slot already carries a DIFFERENT type is untickable (the server rejects per-row).
 * A same-type location stays tickable (it would be an EXISTS skip, amber). Typeless (office/legacy)
 * rows never block.
 */
describe('blockedLocations (one slot = one rate type)', () => {
  const map = existingByLocation([
    row(3, 9, 101, 'LOCAL', 500),
    row(3, 9, 102, 'OGL', 650),
    row(3, 9, 103, null, 700),
    row(3, 9, null, null, 900),
  ]);

  it('blocks locations holding a different type; same type stays tickable', () => {
    const blocked = blockedLocations(map, 'LOCAL');
    expect(blocked.has(102)).toBe(true); // OGL there, adding LOCAL → blocked
    expect(blocked.has(101)).toBe(false); // LOCAL there → amber skip, not blocked
  });

  it('never blocks typeless rows, null (office) keys, or when no type is chosen yet', () => {
    expect(blockedLocations(map, 'LOCAL').has(103)).toBe(false);
    expect(blockedLocations(map, '').size).toBe(0);
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
  const empty = { clientRateType: '', pincodeCount: 0, selectedCount: 0 };

  it('is false when nothing downstream is set', () => {
    expect(modeHasDownstream(empty)).toBe(false);
  });

  it('is true when a rate type, a pincode group, or a selection exists', () => {
    expect(modeHasDownstream({ ...empty, clientRateType: 'LOCAL' })).toBe(true);
    expect(modeHasDownstream({ ...empty, pincodeCount: 1 })).toBe(true);
    expect(modeHasDownstream({ ...empty, selectedCount: 2 })).toBe(true);
  });

  it('pins the helper + action copy', () => {
    expect(MODE_LOCKED_HELPER).toBe('Clear rate-type/location fields to switch mode');
    expect(CLEAR_FIELDS_LABEL).toBe('Clear fields');
  });
});
