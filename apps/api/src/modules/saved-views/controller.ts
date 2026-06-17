import type { Request, Response, NextFunction } from 'express';
import { savedViewService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';

const requireUserId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

// `:id` hits a uuid column — shape-validate before the query so a bad value is a clean 404, not a
// pg 22P02 → 500 (the same uuid-:id guard the notifications/jobs trays use).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (req: Request): string => {
  const id = req.params['id'] ?? '';
  if (!UUID_RE.test(id)) throw AppError.notFound();
  return id;
};

export const savedViewController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(requireUserId(req), req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.create(requireUserId(req), req.body));
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.update(requireUserId(req), requireUuid(req), req.body));
    } catch (e) {
      next(e);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.remove(requireUserId(req), requireUuid(req)));
    } catch (e) {
      next(e);
    }
  },

  async setDefault(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.setDefault(requireUserId(req), requireUuid(req), req.body));
    } catch (e) {
      next(e);
    }
  },
};
