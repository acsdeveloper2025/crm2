import type { Request, Response, NextFunction } from 'express';
import { policyService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { requireVersion } from '../../platform/occ.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';

const parseId = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';

export const policyController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportData(q, ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'policies',
        resource: 'policies',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.get(parseId(req)));
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.create(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.update(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.activate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.deactivate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },

  /** Admin view: GET /api/v2/policies/users/:userId/acceptances — this user's acceptance log. */
  async acceptancesForUser(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.params['userId'];
      res.json(await svc.acceptancesForUser(typeof userId === 'string' ? userId : ''));
    } catch (e) {
      next(e);
    }
  },
};
