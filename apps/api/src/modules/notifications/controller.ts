import type { Request, Response, NextFunction } from 'express';
import { paramStr } from '../../http/params.js';
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
      const id = paramStr(req, 'id');
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

  // ── Feed management: trash + restore (mobile parity) ──

  async listTrash(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listTrash(requireUserId(req), req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async clearAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.clearAll(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async deleteOne(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const id = paramStr(req, 'id');
      if (!UUID_RE.test(id)) throw AppError.notFound();
      res.json(await svc.deleteOne(userId, id));
    } catch (e) {
      next(e);
    }
  },

  async restoreOne(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const id = paramStr(req, 'id');
      if (!UUID_RE.test(id)) throw AppError.notFound();
      res.json(await svc.restoreOne(userId, id));
    } catch (e) {
      next(e);
    }
  },

  async restoreAll(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.restoreAll(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  // ── Per-task mute + delivery preferences (mobile parity) ──

  async mute(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.muteTask(requireUserId(req), req.body));
    } catch (e) {
      next(e);
    }
  },

  async unmuteTask(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUserId(req);
      const taskId = paramStr(req, 'taskId');
      if (!UUID_RE.test(taskId)) throw AppError.notFound();
      res.json(await svc.unmuteTask(userId, taskId));
    } catch (e) {
      next(e);
    }
  },

  async listMutes(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listMutes(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async getPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.getPreferences(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async setPreferences(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.setPreferences(requireUserId(req), req.body));
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
