import { describe, it, expect } from 'vitest';
import { friendlyError } from './CommissionRateRecordPage.js';

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
