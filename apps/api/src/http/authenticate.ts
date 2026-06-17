import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../platform/jwt.js';

const BEARER = 'Bearer ';

/**
 * Real authentication (ADR-0014): verify `Authorization: Bearer <accessToken>` into req.auth.
 * Populates only on a valid token; never rejects here (route guards do). Runs AFTER the dev
 * test-auth seam so a real Bearer token always wins over `x-test-auth`.
 */
export function authenticate() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('authorization');
    if (header?.startsWith(BEARER)) {
      const claims = await verifyAccessToken(header.slice(BEARER.length));
      if (claims) req.auth = { userId: claims.userId, role: claims.role };
    }
    next();
  };
}
