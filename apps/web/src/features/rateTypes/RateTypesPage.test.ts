import { describe, it, expect } from 'vitest';
import { friendlyRateTypeError } from './RateTypesPage.js';
import { ApiError } from '../../lib/sdk.js';

/**
 * CREATE_PAGE_STANDARD §5: the code-keyed rate-type dup is `RATE_TYPE_EXISTS` (not `*_CODE_EXISTS`), so
 * neither shared helper fits — this local map covers it; unknown codes fall through to the raw code.
 */
describe('friendlyRateTypeError', () => {
  it('maps RATE_TYPE_EXISTS and STALE_UPDATE to plain English', () => {
    expect(friendlyRateTypeError(new ApiError(409, 'RATE_TYPE_EXISTS'))).toBe(
      'A rate type with this code already exists.',
    );
    expect(friendlyRateTypeError(new ApiError(409, 'STALE_UPDATE'))).toContain('changed since you opened it');
  });
  it('falls through to the raw code for an unknown ApiError', () => {
    expect(friendlyRateTypeError(new ApiError(400, 'NOPE'))).toBe('NOPE');
  });
});
