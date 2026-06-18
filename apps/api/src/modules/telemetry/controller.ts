import type { Request, Response, NextFunction } from 'express';
import { telemetryService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';

export const telemetryController = {
  ingest(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth?.userId) throw AppError.unauthenticated();
      res.status(HTTP_STATUS.ACCEPTED).json(svc.ingest(req.body));
    } catch (e) {
      next(e);
    }
  },
};
