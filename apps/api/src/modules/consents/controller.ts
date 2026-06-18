import type { Request, Response, NextFunction } from 'express';
import { consentService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

const requireUserId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

export const consentController = {
  async accept(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      res.json(await svc.accept(userId, req.body, req.ip ?? null, req.get('user-agent') ?? null));
    } catch (e) {
      next(e);
    }
  },
};
