import type { Request, Response, NextFunction } from 'express';
import { billingService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const billingController = {
  async listLines(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listLines(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async linesSummary(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.linesSummary(req.query as Record<string, unknown>, actor(req)));
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
        filenameBase: 'billing-lines',
        resource: 'billing/lines',
        actorId: actor(req).userId,
      });
    } catch (e) {
      next(e);
    }
  },

  async commissionSummary(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.commissionSummary(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async commissionSummaryExport(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportCommissionSummary(q, ex, actor(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'commission-summary',
        resource: 'billing/commission-summary',
        actorId: actor(req).userId,
      });
    } catch (e) {
      next(e);
    }
  },

  async commissionDetail(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.commissionDetail(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async commissionDetailExport(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportCommissionDetail(q, ex, actor(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'commission-detail',
        resource: 'billing/commission-detail',
        actorId: actor(req).userId,
      });
    } catch (e) {
      next(e);
    }
  },
};
