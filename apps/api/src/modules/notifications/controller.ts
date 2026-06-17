import type { Request, Response, NextFunction } from 'express';
import { notificationService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';

const requireUserId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

// `:id` hits a uuid column — shape-validate before the query so a bad value is a clean 404, not a
// pg 22P02 → 500 (the uuid-:id 500 class the user-management epic closed).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const notificationController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(requireUserId(req), req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.unreadCount(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async read(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const id = req.params['id'] ?? '';
      if (!UUID_RE.test(id)) throw AppError.notFound();
      res.json(await svc.markRead(userId, id));
    } catch (e) {
      next(e);
    }
  },

  async markAllRead(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.markAllRead(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  /** POST /api/v2/auth/notifications/register — the device registers its FCM token (own user). */
  async registerToken(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.registerToken(requireUserId(req), req.body));
    } catch (e) {
      next(e);
    }
  },
};
