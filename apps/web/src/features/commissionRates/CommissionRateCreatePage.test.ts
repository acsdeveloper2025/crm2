import { describe, it, expect } from 'vitest';
import type { CommissionTerritoryLocation } from '@crm2/sdk';
import {
  groupTerritory,
  createFriendlyError,
  existingByLocation,
  existingRateLabel,
} from './CommissionRateCreatePage.js';

const loc = (
  id: number,
  pincode: string,
  area: string,
  city = 'Mumbai',
  state = 'MH',
): CommissionTerritoryLocation => ({ id, pincode, area, city, state });

/**
 * The territory picker folds the flat per-(pincode,area) rows the lookup returns into per-pincode
 * groups — the grouping key MUST be the pincode (one tick-list per pincode, its areas inside),
 * preserving the server's pincode/area order.
 */
describe('groupTerritory', () => {
  it('groups by pincode, preserving row order within and across groups', () => {
    const groups = groupTerritory([
      loc(1, '400001', 'FORT'),
      loc(2, '400058', 'ANDHERI WEST'),
      loc(3, '400058', 'VERSOVA'),
    ]);
    expect(groups).toEqual([
      { pincode: '400001', city: 'Mumbai', areas: [{ id: 1, area: 'FORT' }] },
      {
        pincode: '400058',
        city: 'Mumbai',
        areas: [
          { id: 2, area: 'ANDHERI WEST' },
          { id: 3, area: 'VERSOVA' },
        ],
      },
    ]);
  });

  it('carries the first row’s city as the group city', () => {
    const groups = groupTerritory([loc(1, '110008', 'PATEL NAGAR', 'West Delhi')]);
    expect(groups[0]).toMatchObject({ pincode: '110008', city: 'West Delhi' });
  });

  it('empty territory folds to no groups (the no-territory state), not a crash', () => {
    expect(groupTerritory([])).toEqual([]);
  });
});

/**
 * Duplicate-prevention hints (owner 2026-07-11): a selected user's existing ACTIVE rates fold into
 * locationId → {rateType, amount} hints shown on the area chips; location-less OFFICE rows group
 * under the null key. The label reads "LOCAL ₹50 · OGL ₹45".
 */
describe('existingByLocation / existingRateLabel', () => {
  const rows = [
    { locationId: 7, fieldRateType: 'LOCAL', amount: 50 },
    { locationId: 7, fieldRateType: 'OGL', amount: 45 },
    { locationId: 9, fieldRateType: 'LOCAL', amount: 60 },
    { locationId: null, fieldRateType: 'OFFICE', amount: 90 },
  ];

  it('groups hints by locationId, preserving row order; OFFICE (null location) under the null key', () => {
    const map = existingByLocation(rows);
    expect(map.get(7)).toEqual([
      { fieldRateType: 'LOCAL', amount: 50 },
      { fieldRateType: 'OGL', amount: 45 },
    ]);
    expect(map.get(9)).toEqual([{ fieldRateType: 'LOCAL', amount: 60 }]);
    expect(map.get(null)).toEqual([{ fieldRateType: 'OFFICE', amount: 90 }]);
    expect(map.get(999)).toBeUndefined(); // a location with no rates has NO hint
  });

  it('empty input → empty map, not a crash', () => {
    expect(existingByLocation([]).size).toBe(0);
  });

  it('labels read "TYPE ₹amount" joined with middots; a null type renders as —', () => {
    expect(
      existingRateLabel([
        { fieldRateType: 'LOCAL', amount: 50 },
        { fieldRateType: 'OGL', amount: 45 },
      ]),
    ).toBe('LOCAL ₹50 · OGL ₹45');
    expect(existingRateLabel([{ fieldRateType: null, amount: 10 }])).toBe('— ₹10');
  });
});

/**
 * The create page's known 4xx codes read as plain English; unknown codes fall through to the raw
 * code (never silently swallowed). The overlap copy is inherited from the shared friendlyError.
 */
describe('createFriendlyError', () => {
  it('inherits the overlap copy verbatim', () => {
    expect(createFriendlyError('COMMISSION_RATE_EXISTS')).toBe(
      'An active rate for this combination already overlaps this period — revise or end-date it first.',
    );
  });

  it('maps the create page’s own codes', () => {
    expect(createFriendlyError('VALIDATION')).toContain('capped at 500 locations');
    expect(createFriendlyError('USER_HAS_NO_TERRITORY')).toContain('no assigned pincodes/areas');
    expect(createFriendlyError('OFFICE_NOT_BULKABLE')).toContain('single rate');
    expect(createFriendlyError('INVALID_RATE_TYPE')).toContain('single rate');
  });

  it('returns null for unknown codes so the raw-code fallback still applies', () => {
    expect(createFriendlyError('STALE_UPDATE')).toBeNull();
    expect(createFriendlyError('')).toBeNull();
  });
});
