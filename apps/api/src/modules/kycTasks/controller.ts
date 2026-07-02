import type { Request, Response, NextFunction } from 'express';
import { kycTasksService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
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
};
