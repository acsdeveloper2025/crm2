import type { Request, Response, NextFunction } from 'express';
import { getRoleAttributes } from '../platform/access/index.js';

/**
 * Auth enrichment (ADR-0022): after authentication establishes WHO the caller is, resolve what
 * their role GRANTS (grants_all + permission codes, cached) onto req.auth so `authorize()` can
 * decide without any code matrix or role-name check. An unknown/inactive role resolves to no
 * attributes → zero permissions (default-deny, fail-closed).
 */
export function enrichAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.auth) {
        const attrs = await getRoleAttributes(req.auth.role);
        req.auth.grantsAll = attrs?.grantsAll ?? false;
        req.auth.permissions = attrs?.permissions ?? [];
      }
      next();
    } catch (e) {
      next(e); // resolution failure is a real error (500), never a silent 403
    }
  };
}
