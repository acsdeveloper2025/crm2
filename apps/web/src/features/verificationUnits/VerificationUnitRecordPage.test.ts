import { describe, it, expect } from 'vitest';
import { lockedChips } from './VerificationUnitRecordPage.js';

/**
 * The locked-profile chips are DERIVED from profileFor() (ADR-0070), so a profile change can't leave the
 * display stale. Pin both worker-role shapes — if profileFor's frozen values change, this fails loudly.
 */
describe('lockedChips (derived from the frozen worker-role profile)', () => {
  it('FIELD_AGENT reflects ≥5 photos, GPS, agent commission, field narrative, revisit', () => {
    expect(lockedChips('FIELD_AGENT')).toEqual([
      '≥5 photos',
      'GPS required',
      'Agent commission',
      'Field narrative',
      'Revisit (parent rate)',
    ]);
  });
  it('KYC_VERIFIER reflects 0 photos, no GPS, client invoice, KYC document, recheck', () => {
    expect(lockedChips('KYC_VERIFIER')).toEqual([
      '0 photos',
      'No GPS',
      'Client invoice',
      'KYC document',
      'Recheck (fresh rate)',
    ]);
  });
});
