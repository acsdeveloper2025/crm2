import type { Request, Response, NextFunction } from 'express';
import { misService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

/**
 * Extract Actor from a route-authorized request. The enrichAuth middleware has already attached
 * `grantsAll` and `permissions` onto `req.auth`; we spread them through so the service can gate
 * billing.view without an extra DB round-trip.
 */
const actor = (req: Request): Actor =>
  req.auth
    ? ({ ...req.auth } as Actor)
    : (() => {
        throw AppError.unauthenticated();
      })();

export const misController = {
  async rows(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.rows(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.exportRows(req.query as Record<string, unknown>, res, actor(req));
    } catch (e) {
      next(e);
    }
  },
};
