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

/**
 * Like {@link authorize}, but passes if the role has ANY of the listed permissions (or `grantsAll`).
 * Used where two legitimate consumer classes both read an endpoint — e.g. the rate-type `available`
 * resolver, reachable by master-data viewers (Rate Management) AND case creators (case-creation preview).
 */
export function authorizeAny(...perms: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      res.status(HTTP_UNAUTHENTICATED).json({ error: 'UNAUTHENTICATED' });
      return;
    }
    if (auth.grantsAll !== true && !perms.some((p) => auth.permissions?.includes(p))) {
      res.status(HTTP_FORBIDDEN).json({ error: 'FORBIDDEN', requiredPermission: perms });
      return;
    }
    next();
  };
}
