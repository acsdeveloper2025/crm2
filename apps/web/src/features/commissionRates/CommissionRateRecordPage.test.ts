import { describe, it, expect } from 'vitest';
import {
  friendlyError,
  PINCODE_NOT_FOUND,
  LOCATIONS_ADMIN_PATH,
  isPincodeNotFound,
} from './CommissionRateRecordPage.js';

/**
 * UX-4: the create 409 must read as plain English, not a raw COMMISSION_RATE_EXISTS code — the page
 * maps its one overlap code locally (same copy as the client-rate page) and falls through to the raw
 * code for anything unknown (STALE_UPDATE is handled separately by the ConflictDialog).
 */
describe('friendlyError (commission rates)', () => {
  it('maps COMMISSION_RATE_EXISTS to the overlap copy, verbatim', () => {
    expect(friendlyError('COMMISSION_RATE_EXISTS')).toBe(
      'An active rate for this combination already overlaps this period — revise or end-date it first.',
    );
  });

  it('returns null for unknown codes so the raw-code fallback still applies', () => {
    expect(friendlyError('STALE_UPDATE')).toBeNull();
    expect(friendlyError('RATE_EXISTS')).toBeNull(); // the client-rate code is NOT this page's code
    expect(friendlyError('')).toBeNull();
  });
});

/**
 * UX-7: a 6-digit pincode with zero matching areas is a dead end today — the Area select just stays
 * disabled with no explanation. isPincodeNotFound gates the explicit message + link to Location
 * Management (the add-location dialog is deliberately NOT built — YAGNI, Location Mgmt is one click
 * away). Gate on isSuccess (not isError/isLoading) so there's no flash while the query is in flight.
 * Same predicate + copy as the client-rate page (RateRecordPage) — pinned independently here so the
 * two pages can't silently drift apart.
 */
describe('isPincodeNotFound (commission rates)', () => {
  it('is false while the pincode is incomplete', () => {
    expect(isPincodeNotFound({ pincode: '4000', isSuccess: true, count: 0 })).toBe(false);
  });

  it('is false while the areas query is still in flight (not yet isSuccess)', () => {
    expect(isPincodeNotFound({ pincode: '400001', isSuccess: false, count: 0 })).toBe(false);
  });

  it('is false once areas are found', () => {
    expect(isPincodeNotFound({ pincode: '400001', isSuccess: true, count: 3 })).toBe(false);
  });

  it('is true for a complete pincode whose areas query succeeded with zero rows', () => {
    expect(isPincodeNotFound({ pincode: '999999', isSuccess: true, count: 0 })).toBe(true);
  });

  it('pins the message copy verbatim', () => {
    expect(PINCODE_NOT_FOUND).toBe('Pincode not found — add it in Location Management first');
  });

  it('pins the Location Management path', () => {
    expect(LOCATIONS_ADMIN_PATH).toBe('/admin/locations');
  });
});
