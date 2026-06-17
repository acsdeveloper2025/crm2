import type { Request, Response, NextFunction } from 'express';
import { paramStr } from '../../http/params.js';
import { jobService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

const requireUserId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

// `:id` hits a uuid column — shape-validate first so a bad value is a clean 404, not a pg 22P02 → 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const jobController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(requireUserId(req), req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const id = paramStr(req, 'id');
      if (!UUID_RE.test(id)) throw AppError.notFound();
      res.json(await svc.get(userId, id));
    } catch (e) {
      next(e);
    }
  },

  async resultUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const id = paramStr(req, 'id');
      if (!UUID_RE.test(id)) throw AppError.notFound();
      res.json(await svc.resultUrl(userId, id));
    } catch (e) {
      next(e);
    }
  },
};
