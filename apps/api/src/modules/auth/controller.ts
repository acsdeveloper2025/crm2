import type { Request, Response, NextFunction } from 'express';
import { authService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';

const requireUserId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

// Session/MFA admin handlers take uuid path params that hit uuid columns (auth_refresh_tokens.jti,
// users.id). Validate the shape BEFORE the query so a malformed value is a clean 400, never a pg
// 22P02 → 500 (the "uuid-:id 500 class" the user-management epic set out to avoid).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuidParam = (value: string | string[] | undefined, param: string): string => {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw AppError.badRequest('BAD_REQUEST', { param });
  return value;
};

export const authController = {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.login(req.body, req.ip ?? null));
    } catch (e) {
      next(e);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ tokens: await svc.refresh(req.body, req.ip ?? null) });
    } catch (e) {
      next(e);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.logout(requireUserId(req));
      res.status(HTTP_STATUS.OK).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.me(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.changePassword(requireUserId(req), req.body);
      res.status(HTTP_STATUS.OK).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  /** Self-service policy acceptance (ADR-0043) — records the user's consent for the pending policy ids. */
  async acceptPolicies(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.acceptPolicies(requireUserId(req), req.body, req.ip ?? null, req.get('user-agent') ?? null);
      res.status(HTTP_STATUS.OK).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  async mfaStatus(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.mfaStatus(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async mfaEnrollStart(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.mfaEnrollStart(requireUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async mfaEnrollVerify(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.mfaEnrollVerify(requireUserId(req), req.body));
    } catch (e) {
      next(e);
    }
  },

  async mfaDisable(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.mfaDisable(requireUserId(req), req.body);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  async mfaAdminDisable(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.mfaAdminDisable(requireUuidParam(req.params['userId'], 'userId'));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  // ── Sessions (slice 6) ── self-service list/revoke; the admin pair is mounted under /users/:id.
  async listSessions(req: Request, res: Response, next: NextFunction) {
    try {
      // currentJti is matched against a uuid column — ignore a non-uuid value (treat as "no current").
      const raw = req.query['currentJti'];
      const currentJti = typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
      res.json(await svc.listSessions(requireUserId(req), currentJti));
    } catch (e) {
      next(e);
    }
  },

  async revokeSession(req: Request, res: Response, next: NextFunction) {
    try {
      // Authenticate first (401 before 400), then validate the param shape.
      const userId = requireUserId(req);
      const jti = requireUuidParam(req.params['jti'], 'jti');
      await svc.revokeSession(userId, jti);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  /** Admin: list another user's active sessions (GET /users/:id/sessions, USER_MANAGE). */
  async adminListSessions(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listSessions(requireUuidParam(req.params['id'], 'id'), null));
    } catch (e) {
      next(e);
    }
  },

  /** Admin: revoke one of another user's sessions (POST /users/:id/sessions/:jti/revoke, USER_MANAGE). */
  async adminRevokeSession(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = requireUuidParam(req.params['id'], 'id');
      const jti = requireUuidParam(req.params['jti'], 'jti');
      await svc.revokeSession(userId, jti);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
};
