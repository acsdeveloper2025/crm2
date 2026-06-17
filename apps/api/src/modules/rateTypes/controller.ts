import type { Request, Response, NextFunction } from 'express';
import { rateTypeService as svc } from './service.js';

export const rateTypeController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query['active'] === 'true'));
    } catch (e) {
      next(e);
    }
  },
};
