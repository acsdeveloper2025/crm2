import type { Request, Response, NextFunction } from 'express';
import { geocodeService as svc } from './service.js';

export const geocodeController = {
  async reverse(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.reverse(req.query['lat'], req.query['lng']));
    } catch (e) {
      next(e);
    }
  },

  /** Open reverse-geocode DLQ (ADR-0040 Slice B; ops/SA). */
  async dlq(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.dlq());
    } catch (e) {
      next(e);
    }
  },

  /** Re-enqueue every open DLQ row (ops/SA). */
  async replayDlq(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.replayDlq());
    } catch (e) {
      next(e);
    }
  },
};
