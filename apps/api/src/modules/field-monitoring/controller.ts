import type { Request, Response, NextFunction } from 'express';
import { paramStr } from '../../http/params.js';
import { fieldMonitoringService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const fieldMonitoringController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.stats(req.query as Record<string, unknown>, actor(req)));
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
        filenameBase: 'field-monitoring',
        resource: 'field-monitoring',
        actorId: req.auth?.userId ?? 'unknown',
      });
    } catch (e) {
      next(e);
    }
  },

  /** POST /agents/:id/request-location — wake a field agent for a fresh GPS fix (ADR-0027). */
  async requestLocation(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.requestLocation(actor(req), paramStr(req, 'id')));
    } catch (e) {
      next(e);
    }
  },
};
