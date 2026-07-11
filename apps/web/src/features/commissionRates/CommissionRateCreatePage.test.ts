import { describe, it, expect } from 'vitest';
import type { CommissionTerritoryLocation } from '@crm2/sdk';
import { groupTerritory, createFriendlyError } from './CommissionRateCreatePage.js';

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
