import type { Request, Response, NextFunction } from 'express';
import { billingService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};
const parseCaseId = (req: Request): string => {
  const id = req.params['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};

export const billingController = {
  async listCases(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listCases(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportData(q, ex, actor(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'billing-cases',
        resource: 'billing/cases',
        actorId: actor(req).userId,
      });
    } catch (e) {
      next(e);
    }
  },

  async caseTasks(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.caseTasks(parseCaseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },
};
