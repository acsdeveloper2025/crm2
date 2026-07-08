import type { Request, Response, NextFunction } from 'express';
import { clientProductService as cpSvc, cpvUnitService as cpvSvc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { requireVersion } from '../../platform/occ.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import { resolveImportMode, writeTemplate } from '../../platform/import/index.js';

const parseId = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';
const parseActive = (raw: unknown): boolean | undefined => (raw === undefined ? undefined : raw === 'true');
const parsePositiveInt = (raw: unknown): number | undefined => {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

export const clientProductController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpSvc.list(req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await cpSvc.exportData(q, ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'client-products',
        resource: 'client_products',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await cpSvc.create(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await cpSvc.importTemplate(), 'client-products');
    } catch (e) {
      next(e);
    }
  },

  async import(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = resolveImportMode(req.query as Record<string, unknown>);
      const file = req.body as unknown;
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('NO_IMPORT_FILE', { hint: 'POST the .xlsx/.csv file bytes as the body' });
      const fn = req.headers['x-filename'];
      const fileName = typeof fn === 'string' ? fn : undefined;
      res.json(
        mode === 'preview'
          ? await cpSvc.importPreview(file)
          : await cpSvc.importConfirm(file, userId(req), fileName),
      );
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpSvc.update(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpSvc.activate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpSvc.deactivate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },
};

export const cpvUnitController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const clientProductId = parsePositiveInt(req.query['clientProductId']);
      if (clientProductId === undefined)
        throw AppError.badRequest('BAD_REQUEST', { param: 'clientProductId' });
      const active = parseActive(req.query['active']);
      res.json(await cpvSvc.list({ clientProductId, ...(active === undefined ? {} : { active }) }));
    } catch (e) {
      next(e);
    }
  },

  /** ADR-0074: GET /cpv-units/available?clientId&productId — the CPV-scoped units for a client+product
   *  (a Universal CPV ⇒ all active units). Feeds the config unit pickers. */
  async available(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = parsePositiveInt(req.query['clientId']);
      const productId = parsePositiveInt(req.query['productId']);
      if (clientId === undefined || productId === undefined)
        throw AppError.badRequest('BAD_REQUEST', { param: 'clientId, productId' });
      res.json(await cpvSvc.availableUnits(clientId, productId));
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await cpvSvc.exportData(q, ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'cpv-units',
        resource: 'client_product_verification_units',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await cpvSvc.create(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  /** UX-6: bulk-enable concrete units for one client-product — per-row CREATED/REACTIVATED/ERROR. */
  async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpvSvc.bulkCreate(req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await cpvSvc.importTemplate(), 'cpv-units');
    } catch (e) {
      next(e);
    }
  },

  async import(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = resolveImportMode(req.query as Record<string, unknown>);
      const file = req.body as unknown;
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('NO_IMPORT_FILE', { hint: 'POST the .xlsx/.csv file bytes as the body' });
      const fn = req.headers['x-filename'];
      const fileName = typeof fn === 'string' ? fn : undefined;
      res.json(
        mode === 'preview'
          ? await cpvSvc.importPreview(file)
          : await cpvSvc.importConfirm(file, userId(req), fileName),
      );
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpvSvc.update(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async activate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpvSvc.activate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await cpvSvc.deactivate(parseId(req), requireVersion(req.body), userId(req)));
    } catch (e) {
      next(e);
    }
  },
};
