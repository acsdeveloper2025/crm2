import { describe, it, expect } from 'vitest';
import { friendlyMasterError } from './friendlyError.js';
import { ApiError } from './sdk.js';

/**
 * CREATE_PAGE_STANDARD §5: known write codes → plain English, unknown codes fall through to the raw
 * code (never swallowed). The duplicate-code text is composed client-side because the API body carries
 * only `{ error: code }` — the error middleware drops `AppError.message`.
 */
describe('friendlyMasterError', () => {
  it('builds the duplicate-code sentence from the attempted code (any *_CODE_EXISTS)', () => {
    expect(friendlyMasterError(new ApiError(409, 'CLIENT_CODE_EXISTS'), 'Client', 'hdfc')).toBe(
      'A client with code “HDFC” already exists.',
    );
    expect(friendlyMasterError(new ApiError(409, 'UNIT_CODE_EXISTS'), 'Verification unit', 'pan_card')).toBe(
      'A verification unit with code “PAN_CARD” already exists.',
    );
  });

  it('maps CODE_LOCKED and STALE_UPDATE to their fixed copy', () => {
    expect(friendlyMasterError(new ApiError(409, 'CODE_LOCKED'), 'Client')).toContain(
      'in use by other records',
    );
    expect(friendlyMasterError(new ApiError(409, 'STALE_UPDATE'), 'Client')).toContain(
      'changed since you opened it',
    );
  });

  it('falls through to the raw code for an unknown ApiError, never swallowing it', () => {
    expect(friendlyMasterError(new ApiError(400, 'SOME_NEW_CODE'), 'Client')).toBe('SOME_NEW_CODE');
  });

  it('handles a plain Error and a non-Error', () => {
    expect(friendlyMasterError(new Error('boom'), 'Client')).toBe('boom');
    expect(friendlyMasterError('nope', 'Client')).toBe('Something went wrong.');
  });
});
