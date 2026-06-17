import type { Request, Response, NextFunction } from 'express';
import { systemService as svc } from './service.js';

export const systemController = {
  async health(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.health());
    } catch (e) {
      next(e);
    }
  },
};
