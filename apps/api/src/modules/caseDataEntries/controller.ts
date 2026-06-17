import type { Request, Response, NextFunction } from 'express';
import { caseDataEntryService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};
const caseId = (req: Request): string => req.params['caseId'] ?? '';

export const caseDataEntryController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.get(caseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async save(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.save(caseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async getPickup(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.getPickup(caseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async savePickup(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.savePickup(caseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },
};
