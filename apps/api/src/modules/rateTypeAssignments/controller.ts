import type { Request, Response, NextFunction } from 'express';
import { rateTypeAssignmentService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import { resolveImportMode, writeTemplate } from '../../platform/import/index.js';

const parseId = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';

export const rateTypeAssignmentController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>));
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

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportData(q, ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'rate-type-assignments',
        resource: 'rate-type-assignments',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await svc.importTemplate(), 'rate-type-assignments');
    } catch (e) {
      next(e);
    }
  },

  async import(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = resolveImportMode(req.query as Record<string, unknown>);
      const file = req.body as unknown;
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('NO_IMPORT_FILE', { hint: 'POST the .xlsx file bytes as the body' });
      const fn = req.headers['x-filename'];
      const fileName = typeof fn === 'string' ? fn : undefined;
      res.json(
        mode === 'preview'
          ? await svc.importPreview(file)
          : await svc.importConfirm(file, userId(req), fileName),
      );
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

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.deactivate(parseId(req), userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async bulkDeactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.bulkDeactivate(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },
};
