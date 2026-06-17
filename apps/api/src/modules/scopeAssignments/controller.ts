import type { Request, Response, NextFunction } from 'express';
import { scopeAssignmentService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveImportMode, writeTemplate } from '../../platform/import/index.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorId = (req: Request): string => req.auth?.userId ?? 'unknown';

/** The `:id` hits a uuid `user_id` column — validate before the query (400, never a pg 22P02 → 500).
 *  No subtree guard needed: these routes are ACCESS_SCOPE_ASSIGN = SUPER_ADMIN only, who is global. */
const targetUserId = (req: Request): string => {
  const id = req.params['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const intParam = (req: Request, name: string): number => {
  const raw = req.params[name];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw AppError.badRequest('BAD_REQUEST', { param: name });
  return n;
};

export const scopeAssignmentController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.get(targetUserId(req)));
    } catch (e) {
      next(e);
    }
  },

  async add(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.add(targetUserId(req), req.body, actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.remove(targetUserId(req), intParam(req, 'assignmentId'), actorId(req)));
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await svc.importTemplate(), 'user_scope_assignments');
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
          : await svc.importConfirm(file, actorId(req), fileName),
      );
    } catch (e) {
      next(e);
    }
  },

  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const ex = resolveExport(req.query as Record<string, unknown>);
      const { rows, columns } = await svc.exportData(ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'user_scope_assignments',
        resource: 'user_scope_assignments',
        actorId: actorId(req),
      });
    } catch (e) {
      next(e);
    }
  },
};
