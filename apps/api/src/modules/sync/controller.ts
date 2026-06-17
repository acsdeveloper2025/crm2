import type { Request, Response, NextFunction } from 'express';
import { syncService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // route is authorize()-guarded, so auth is always present; fail closed if it ever isn't
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const syncController = {
  async download(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.download(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },
};
