import { describe, it, expect } from 'vitest';
import { MASTER_DATA_CODE_TITLE } from './MasterDataCrud.js';

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
