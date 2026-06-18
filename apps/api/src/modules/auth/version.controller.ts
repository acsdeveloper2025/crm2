import type { Request, Response, NextFunction } from 'express';
import { versionService as svc } from './version.service.js';

/** POST /api/v2/auth/version-check — public (pre-auth) mobile force-update gate (mobile parity). */
export const versionController = {
  async check(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.checkVersion(req.body));
    } catch (e) {
      next(e);
    }
  },
};
