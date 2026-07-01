import type { Request, Response, NextFunction } from 'express';
import { PERMISSIONS } from '@crm2/access';
import { misService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't.
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

/** Money columns (rate/commission) are gated by billing.view — enforced identically here, in the
 *  service (catalog + selection), and the repository (laterals). */
const canViewBilling = (req: Request): boolean =>
  !!req.auth &&
  (req.auth.grantsAll === true || (req.auth.permissions ?? []).includes(PERMISSIONS.BILLING_VIEW));

export const misController = {
  reportTypes(req: Request, res: Response, next: NextFunction): void {
    try {
      res.json(svc.reportTypes(canViewBilling(req)));
    } catch (e) {
      next(e);
    }
  },
  async rows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = String(req.params['type'] ?? '');
      res.json(await svc.list(type, req.query as Record<string, unknown>, actor(req), canViewBilling(req)));
    } catch (e) {
      next(e);
    }
  },
  async summary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = String(req.params['type'] ?? '');
      res.json(
        await svc.summary(type, req.query as Record<string, unknown>, actor(req), canViewBilling(req)),
      );
    } catch (e) {
      next(e);
    }
  },
  async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = String(req.params['type'] ?? '');
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const a = actor(req);
      const { rows, columns } = await svc.exportData(type, q, ex, a, canViewBilling(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: `mis-${type.toLowerCase()}`,
        resource: `mis/${type}`,
        actorId: a.userId,
      });
    } catch (e) {
      next(e);
    }
  },
};
