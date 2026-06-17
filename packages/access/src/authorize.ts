import type { Request, Response, NextFunction } from 'express';
import type { Permission } from './permissions.js';

export interface AuthContext {
  userId: string;
  /** OPEN role catalog (ADR-0022): a `roles.code` — system or custom. Never name-checked;
   *  the enrichment middleware resolves it to attributes, which is all authorize() reads. */
  role: string;
  /** Resolved role attributes (ADR-0022) — set by the app's enrichment middleware from the
   *  roles/role_permissions tables (cached). Absent/empty = no permissions (default-deny). */
  grantsAll?: boolean;
  permissions?: readonly string[];
}

/** HTTP statuses used by the access guard (Request augmentation lives in express-augment.d.ts). */
const HTTP_UNAUTHENTICATED = 401;
const HTTP_FORBIDDEN = 403;

/**
 * 401 if unauthenticated, 403 if the resolved role attributes lack `perm` (ADR-0022 cutover:
 * the decision reads DB-backed attributes on req.auth, never a code matrix or a role name).
 */
export function authorize(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      res.status(HTTP_UNAUTHENTICATED).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    if (auth.grantsAll !== true && !auth.permissions?.includes(perm)) {
      res.status(HTTP_FORBIDDEN).json({ error: 'FORBIDDEN', requiredPermission: perm });
      return;
    }
    next();
  };
}
