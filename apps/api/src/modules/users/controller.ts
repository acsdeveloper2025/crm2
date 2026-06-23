import type { Request, Response, NextFunction } from 'express';
import { TempPasswordSchema } from '@crm2/sdk';
import { userService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { requireVersion } from '../../platform/occ.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import { resolveImportMode, writeTemplate } from '../../platform/import/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseId = (req: Request): string => {
  const id = req.params['id'];
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';
/** Profile-photo bytes from EITHER transport (ADR-0011 additive): a multipart `photo` file
 *  (mobile → multer's `req.file.buffer`) or the raw request body (web/admin → `raw()`'s Buffer). */
const photoBytes = (req: Request): unknown => req.file?.buffer ?? req.body;
/** The authenticated caller's own id — for the self-service `/me` routes (no admin perm). 401 when
 *  there is no session (these routes carry no `authorize()`, so the guard lives here). */
const selfId = (req: Request): string => {
  const id = req.auth?.userId;
  if (!id) throw AppError.unauthenticated();
  return id;
};

export const userController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>));
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

  /** A single user by id — the admin record-page loader. Thin: parse the uuid → service → the joined
   *  `UserView` (same shape as a list row). 404 USER_NOT_FOUND on a miss. */
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.getById(parseId(req)));
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
        filenameBase: 'users',
        resource: 'users',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async importTemplate(_req: Request, res: Response, next: NextFunction) {
    try {
      writeTemplate(res, await svc.importTemplate(), 'users');
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

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.update(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  // ── Self-service "my account" (/me) — the caller acts only on their OWN row (IDOR-safe: the id is
  //    taken from the session, never the path/body). ──
  async meProfile(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.selfProfile(selfId(req)));
    } catch (e) {
      next(e);
    }
  },

  async meUpdateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.updateSelfContact(selfId(req), req.body));
    } catch (e) {
      next(e);
    }
  },

  async meUploadPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const id = selfId(req);
      // Multipart `photo` (mobile) → req.file.buffer; raw bytes (web/admin) → req.body Buffer.
      const file = photoBytes(req);
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('INVALID_IMAGE', { reason: 'empty' });
      res.json(await svc.setPhoto(id, file, id));
    } catch (e) {
      next(e);
    }
  },

  async mePhotoUrl(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.photoUrl(selfId(req)));
    } catch (e) {
      next(e);
    }
  },

  async setPassword(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.setPassword(parseId(req), req.body, userId(req));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  async generateTempPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { deliver } = TempPasswordSchema.parse(req.body ?? {});
      res.json(await svc.generateTempPassword(parseId(req), userId(req), deliver));
    } catch (e) {
      next(e);
    }
  },

  async unlock(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.unlock(parseId(req), userId(req));
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },

  /** Upload/replace a profile photo (slice 7). The image bytes ride as a multipart `photo` field
   *  (mobile) OR as the raw body (web/admin); the type is validated from the bytes, not the declared
   *  header. */
  async uploadPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const file = photoBytes(req);
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('INVALID_IMAGE', { reason: 'empty' });
      res.json(await svc.setPhoto(parseId(req), file, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  async photoUrl(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.photoUrl(parseId(req)));
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
