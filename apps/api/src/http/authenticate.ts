import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../platform/jwt.js';
import { isAccessRevoked } from '../platform/tokenRevocation/index.js';

const BEARER = 'Bearer ';

/**
 * Real authentication (ADR-0014): verify `Authorization: Bearer <accessToken>` into req.auth.
 * Populates only on a valid token; never rejects here (route guards do). Runs AFTER the dev
 * test-auth seam so a real Bearer token always wins over `x-test-auth`.
 *
 * Access-token kill switch (ADR-0076 Phase 2): after a valid signature, a user-wide revoke that
 * postdates the token's `iat` means it was killed before its TTL — leave req.auth unset so the route
 * guard 401s. The cutoff read is fail-CLOSED (a DB error throws → 500, never a silent allow): a DB
 * outage already fails every request, so this never weakens availability beyond the baseline.
 */
export function authenticate() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization');
    if (header?.startsWith(BEARER)) {
      const claims = await verifyAccessToken(header.slice(BEARER.length));
      if (claims && !(await isAccessRevoked(claims.userId, claims.iat)))
        req.auth = { userId: claims.userId, role: claims.role };
    }
    next();
  };
}
