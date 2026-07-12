import { ApiError } from './sdk.js';

/**
 * Plain-English copy for the master-data write errors (CREATE_PAGE_STANDARD §5), shared by every
 * code+name catalog page (Clients/Products via MasterDataCrud, Verification Units, …). The API error
 * body carries only `{ error: code }` — the error middleware drops `AppError.message` (`http/app.ts`) —
 * so the duplicate-code text is composed here from the attempted code. Unknown codes fall through to
 * the raw code so nothing is ever swallowed. `entity` is the singular label ("Client" / "Verification
 * unit"); the `*_CODE_EXISTS` match covers CLIENT_/PRODUCT_/UNIT_CODE_EXISTS.
 */
export function friendlyMasterError(e: unknown, entity: string, attemptedCode?: string): string {
  if (e instanceof ApiError) {
    if (e.code.endsWith('_CODE_EXISTS'))
      return `A ${entity.toLowerCase()} with code “${(attemptedCode ?? '').toUpperCase()}” already exists.`;
    if (e.code === 'CODE_LOCKED')
      return 'This code is in use by other records and can’t be changed. Deactivate and recreate to fix it.';
    if (e.code === 'STALE_UPDATE')
      return 'This row changed since you opened it — refreshed; Save again to re-apply.';
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

/**
 * Same as {@link friendlyMasterError} but for NAME-keyed masters (Departments, Designations — org
 * sub-entities whose unique key is `name`, not `code`). Their duplicate code is `<ENTITY>_EXISTS`
 * (e.g. DEPARTMENT_EXISTS), so the sentence is name-based. Unknown codes fall through to the raw code.
 */
export function friendlyNameError(e: unknown, entity: string): string {
  if (e instanceof ApiError) {
    if (e.code.endsWith('_EXISTS')) return `A ${entity.toLowerCase()} with this name already exists.`;
    if (e.code === 'STALE_UPDATE')
      return 'This row changed since you opened it — refreshed; Save again to re-apply.';
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}
