import type { Request, Response, NextFunction } from 'express';
import { rateTypeAssignmentService as svc } from './service.js';

const userId = (req: Request): string => req.auth?.userId ?? 'unknown';

export const rateTypeAssignmentController = {
  async listForClientProduct(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listForClientProduct(req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async bulkSet(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.bulkSet(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },
};
