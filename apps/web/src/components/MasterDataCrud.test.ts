import { describe, it, expect } from 'vitest';
import { MASTER_DATA_CODE_TITLE, friendlyMasterError } from './MasterDataCrud.js';
import { ApiError } from '../lib/sdk.js';

/**
 * UX-12: MasterDataCrud's code column stays `editable` (unlike DataGrid's `createOnly` flag) —
 * it's only locked once another record references it (CODE_LOCKED, enforced server-side in
 * `save`). Different mutability semantics from the grid's createOnly columns, hence a different
 * tooltip copy — pinned here so the two don't silently drift.
 */
describe('MasterDataCrud code-cell tooltip (UX-12)', () => {
  it('pins the code-locks-once-referenced copy', () => {
    expect(MASTER_DATA_CODE_TITLE).toBe('Code locks once referenced');
  });
});

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
    expect(friendlyMasterError(new ApiError(409, 'PRODUCT_CODE_EXISTS'), 'Product', 'HOME_LOAN')).toBe(
      'A product with code “HOME_LOAN” already exists.',
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
