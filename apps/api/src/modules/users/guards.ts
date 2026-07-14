import type { Request, NextFunction, RequestHandler } from 'express';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { getRoleAttributes } from '../../platform/access/index.js';
import { userRepository as repo } from './repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AUTHORIZATION-04, second half. `assertCanAssignRole` (service.ts) already stops a non-admin from
 * GRANTING a `grantsAll` role. It does nothing about MUTATING a user who already holds one — and every
 * handler under `/users/:id` takes the target on trust, because `user.manage` and
 * `access_scope.assign` are documented SUPER_ADMIN-only (routes.ts) and the code was written to that
 * assumption.
 *
 * The assumption is not enforced anywhere. The RBAC editor offers both permissions for ANY role and
 * warns only that "ROLES — MANAGE … is effectively admin-equivalent" — so `user.manage` is one tick
 * from handing a non-admin role a full takeover: the admin one-time-password reset route returns the
 * new plaintext in its response, and the admin's id is the well-known seed constant. (Ticked for
 * MANAGER on production 2026-07-14, caught by audit, reverted the same day.)
 *
 * So the rule is enforced in code rather than assumed: **a non-`grantsAll` actor may not manage a
 * `grantsAll` target.** Today every holder of these permissions IS an admin, so this is a no-op —
 * that is the point. It is the net under the checkbox.
 *
 * Reads are deliberately NOT guarded: seeing an admin row is not escalation, and `GET /users` is
 * gated separately. This is about mutation.
 */

/** True when `role` is an admin-equivalent (grants_all) role. Attributes are cached (5s). */
async function roleIsElevated(role: string): Promise<boolean> {
  return (await getRoleAttributes(role))?.grantsAll === true;
}

/**
 * Throws FORBIDDEN when a non-admin actor targets an admin user. Unknown/absent target → no throw:
 * the handler's own `findById` owns the 404 (this guard must not become an existence oracle, and must
 * not change any current response).
 */
export async function assertNotElevatedTarget(actorGrantsAll: boolean, targetId: string): Promise<void> {
  if (actorGrantsAll) return;
  const target = await repo.findById(targetId);
  if (!target) return;
  if (!(await roleIsElevated(target.role))) return;
  throw new AppError(HTTP_STATUS.FORBIDDEN, 'CANNOT_MODIFY_ELEVATED_USER');
}

/**
 * Route guard for every mutating `/users/:id…` path — including the ones whose handlers live in other
 * modules (auth session revoke, scope assignments, KYC units), which a service-level check inside
 * users/ would silently miss. The bulk array routes carry no `:id`, so `bulkSetActive` calls
 * `assertNotElevatedTarget` per row instead.
 */
export function denyElevatedTarget(): RequestHandler {
  return (req: Request, _res: unknown, next: NextFunction): void => {
    const id = req.params['id'];
    // Not a uuid → let the handler's own parse produce its 400/404 unchanged.
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      next();
      return;
    }
    assertNotElevatedTarget(req.auth?.grantsAll === true, id).then(
      () => next(),
      (e: unknown) => next(e),
    );
  };
}
