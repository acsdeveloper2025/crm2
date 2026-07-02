import type { Request, Response, NextFunction } from 'express';
import { kycTasksService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't.
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const kycTasksController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const a = actor(req);
      const { rows, columns } = await svc.exportData(q, ex, a);
      // cols: [] — the service already picked + expanded the columns (per-label detail columns are
      // NOT grid column ids, so writeExport's own selection must not re-filter them away).
      await writeExport(res, {
        rows,
        columns,
        ex: { ...ex, cols: [] },
        filenameBase: 'kyc-tasks',
        resource: 'kyc-tasks',
        actorId: a.userId,
      });
    } catch (e) {
      next(e);
    }
  },
};
