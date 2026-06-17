import type { Request, Response, NextFunction } from 'express';
import { roleService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';

const ROLE_CODE_RE = /^[A-Z][A-Z0-9_]{1,19}$/; // matches roles.code varchar(20), UPPER_SNAKE

const actorId = (req: Request): string => req.auth?.userId ?? 'unknown';

const roleCode = (req: Request): string => {
  const code = req.params['code'];
  if (typeof code !== 'string' || !ROLE_CODE_RE.test(code))
    throw AppError.badRequest('BAD_REQUEST', { param: 'code' });
  return code;
};

export const roleController = {
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
        filenameBase: 'roles',
        resource: 'roles',
        actorId: actorId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async options(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.options());
    } catch (e) {
      next(e);
    }
  },

  async dimensions(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.dimensions());
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.create(req.body, actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.update(roleCode(req), req.body, actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.activate(roleCode(req), requireVersion(req.body), actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.deactivate(roleCode(req), requireVersion(req.body), actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async setPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.setPermissions(roleCode(req), req.body, actorId(req)));
    } catch (e) {
      next(e);
    }
  },
};
