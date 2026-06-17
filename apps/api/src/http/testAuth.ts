import type { Request, Response, NextFunction } from 'express';

/**
 * Dev/test auth: reads `x-test-auth: <role>:<userId>` into req.auth.
 * Enabled only when NODE_ENV !== production. Real JWT auth replaces this in a later step.
 */
export function testAuth() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('x-test-auth');
    if (header) {
      const [role, userId] = header.split(':');
      req.auth = { role: role ?? '', userId: userId ?? 'test-user' };
    }
    next();
  };
}
