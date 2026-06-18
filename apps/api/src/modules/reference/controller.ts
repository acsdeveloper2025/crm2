import type { Request, Response, NextFunction } from 'express';
import { referenceService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

/** Reference feeds carry no PII and no user scope, but stay authenticated (no anonymous reads). */
const requireAuth = (req: Request): void => {
  if (!req.auth?.userId) throw AppError.unauthenticated();
};

export const referenceController = {
  async verificationTypeOutcomes(req: Request, res: Response, next: NextFunction) {
    try {
      requireAuth(req);
      res.json(await svc.verificationTypeOutcomes());
    } catch (e) {
      next(e);
    }
  },

  async revokeReasons(req: Request, res: Response, next: NextFunction) {
    try {
      requireAuth(req);
      res.json(await svc.revokeReasons());
    } catch (e) {
      next(e);
    }
  },
};
