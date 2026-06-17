import type { Request, Response, NextFunction } from 'express';
import { locationService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { requireVersion } from '../../platform/occ.js';
import { exportOrEnqueue } from '../../platform/export/job.js';
import { importConfirmOrEnqueue, resolveImportMode, writeTemplate } from '../../platform/import/index.js';

const parseId = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';

export const locationController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async pincodes(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query;
      res.json(await svc.pincodes(typeof q === 'string' ? q : undefined));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      // <10k streams synchronously; an `all` export ≥ EXPORT_JOB_THRESHOLD (157k catalog) enqueues a
      // background EXPORT job (202 + job row) the FE polls + downloads (ADR-0030 / B-13).
      await exportOrEnqueue(req, res, {
        resource: 'locations',
        filenameBase: 'locations',
        run: (ex) => svc.exportData(req.query as Record<string, unknown>, ex),
      });
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await svc.importTemplate(), 'locations');
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
      if (mode === 'preview') {
        res.json(await svc.importPreview(file));
        return;
      }
      // Confirm: <10k runs inline; ≥10k → a background IMPORT job (202 + job row) the FE tracks in
      // the Jobs tray. The worker re-runs the SAME registered runner (B-14, ADR-0030).
      const out = await importConfirmOrEnqueue(file, 'locations', { userId: userId(req), fileName });
      if (out.kind === 'job') res.status(HTTP_STATUS.ACCEPTED).json(out.job);
      else res.json(out.result);
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

  async createBatch(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.createBatch(req.body, userId(req)));
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

  async bulkActivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.bulkSetActive(req.body, true, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async bulkDeactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.bulkSetActive(req.body, false, userId(req)));
    } catch (e) {
      next(e);
    }
  },
};
