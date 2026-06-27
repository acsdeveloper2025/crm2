import type { Request, Response, NextFunction } from 'express';

/**
 * Dev/test auth: reads `x-test-auth: <role>:<userId>` into req.auth.
 * Enabled only when NODE_ENV !== production. Real JWT auth replaces this in a later step.
 */
export function testAuth() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Defense-in-depth (ADR-0076): even if this middleware is ever mounted in production by a
    // misconfigured boot, it must never honor the x-test-auth seam there. The app.ts mount guard
    // is the first line; this is the second.
    if (process.env['NODE_ENV'] === 'production') {
      next();
      return;
    }
    const header = req.header('x-test-auth');
    if (header) {
      const [role, userId] = header.split(':');
      req.auth = { role: role ?? '', userId: userId ?? 'test-user' };
    }
    next();
  };
}
