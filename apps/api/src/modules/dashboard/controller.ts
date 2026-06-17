import type { Request, Response, NextFunction } from 'express';
import { dashboardService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const dashboardController = {
  async stats(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.stats(actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async portfolio(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.portfolio(actor(req)));
    } catch (e) {
      next(e);
    }
  },
};
