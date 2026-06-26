import type { Request, Response, NextFunction } from 'express';
import { userKycUnitsService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorId = (req: Request): string => req.auth?.userId ?? 'unknown';
/** The `:id` hits a uuid `user_id` — validate before the query (400, never a pg 22P02 → 500). */
const targetUserId = (req: Request): string => {
  const id = req.params['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};

export const userKycUnitsController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.get(targetUserId(req)));
    } catch (e) {
      next(e);
    }
  },
  async set(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.set(targetUserId(req), req.body, actorId(req)));
    } catch (e) {
      next(e);
    }
  },
};
