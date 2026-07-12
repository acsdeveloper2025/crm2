import { describe, it, expect } from 'vitest';
import { friendlyError } from './RateRecordPage.js';

/**
 * UX-4: the revise 409 must read as plain English, not a raw server code — the page maps RATE_EXISTS
 * locally and falls through to the raw code for anything unknown (STALE_UPDATE is handled separately
 * by the ConflictDialog and must NOT be swallowed by this map). The create-branch helpers moved to
 * RateCreatePage with the merged single+multi create page (see RateCreatePage.test.ts).
 */
describe('friendlyError (rates)', () => {
  it('maps RATE_EXISTS to the overlap copy, verbatim', () => {
    expect(friendlyError('RATE_EXISTS')).toBe(
      'An active rate for this combination already overlaps this period — revise or end-date it first.',
    );
  });

  it('returns null for unknown codes so the raw-code fallback still applies', () => {
    expect(friendlyError('STALE_UPDATE')).toBeNull();
    expect(friendlyError('VALIDATION')).toBeNull();
    expect(friendlyError('')).toBeNull();
  });
});
