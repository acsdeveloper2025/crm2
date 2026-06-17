import type { Request, Response, NextFunction } from 'express';
import { PERMISSIONS } from '@crm2/access';
import { taskService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

/** Whether the actor may see the billing.view-gated ₹ amounts (comp data, 5a/5b). The Pipeline list
 *  is case.view-gated and held by roles WITHOUT billing.view (FIELD_AGENT/TEAM_LEADER) → the amounts
 *  are nulled for them server-side; this flag is the single source of truth (FE only hides columns). */
const canViewBilling = (req: Request): boolean =>
  !!req.auth &&
  (req.auth.grantsAll === true || (req.auth.permissions ?? []).includes(PERMISSIONS.BILLING_VIEW));

export const taskController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>, actor(req), canViewBilling(req)));
    } catch (e) {
      next(e);
    }
  },

  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.stats(req.query as Record<string, unknown>, actor(req), canViewBilling(req)));
    } catch (e) {
      next(e);
    }
  },

  async assignableUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const visitType = req.query['visitType'] === 'OFFICE' ? 'OFFICE' : 'FIELD';
      res.json(await svc.assignableUsers(req.query['taskIds'], actor(req), visitType));
    } catch (e) {
      next(e);
    }
  },

  async bulkAssign(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.bulkAssign(req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportData(q, ex, actor(req), canViewBilling(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'tasks',
        resource: 'tasks',
        actorId: req.auth?.userId ?? 'unknown',
      });
    } catch (e) {
      next(e);
    }
  },
};
