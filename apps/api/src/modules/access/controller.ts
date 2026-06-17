import type { Request, Response, NextFunction } from 'express';
import { accessService as svc } from './service.js';

export const accessController = {
  async matrix(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.matrix());
    } catch (e) {
      next(e);
    }
  },
};
