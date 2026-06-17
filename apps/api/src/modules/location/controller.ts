import type { Request, Response, NextFunction } from 'express';
import { locationService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const locationController = {
  async capture(req: Request, res: Response, next: NextFunction) {
    try {
      const key = req.header('Idempotency-Key') ?? undefined;
      res.json(await svc.capture(req.body, actor(req), key));
    } catch (e) {
      next(e);
    }
  },
};
