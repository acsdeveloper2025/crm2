import type { Request, Response, NextFunction } from 'express';
import { paramStr } from '../../http/params.js';
import { formsService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

export const formsController = {
  template(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.auth?.userId) throw AppError.unauthenticated();
      res.json(svc.template(paramStr(req, 'formType')));
    } catch (e) {
      next(e);
    }
  },
};
