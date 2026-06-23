import type { Request, Response, NextFunction } from 'express';
import archiver from 'archiver';
import { caseService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import type { Actor } from '../../platform/scope/index.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parseUuidParam = (req: Request, name: string): string => {
  const v = req.params[name];
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw AppError.badRequest('BAD_REQUEST', { param: name });
  return v;
};
const parseId = (req: Request): string => parseUuidParam(req, 'id');
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';
const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};
const parsePositiveInt = (raw: unknown): number | undefined => {
  if (typeof raw !== 'string') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
export const caseController = {
  async dedupe(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.dedupe(req.body));
    } catch (e) {
      next(e);
    }
  },

  /** Standalone Dedupe Check page (dedupe.view): paginated cross-case duplicate lookup. */
  async dedupeSearch(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.dedupeSearch(req.query as Record<string, unknown>));
    } catch (e) {
      next(e);
    }
  },

  async dedupeSearchExport(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.dedupeSearchExport(q, ex);
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'dedupe',
        resource: 'dedupe',
        actorId: req.auth?.userId ?? 'unknown',
      });
    } catch (e) {
      next(e);
    }
  },

  async availableUnits(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = parsePositiveInt(req.query['clientId']);
      const productId = parsePositiveInt(req.query['productId']);
      if (clientId === undefined || productId === undefined)
        throw AppError.badRequest('BAD_REQUEST', { param: 'clientId, productId' });
      res.json(await svc.availableUnits(clientId, productId));
    } catch (e) {
      next(e);
    }
  },

  async ratePreview(req: Request, res: Response, next: NextFunction) {
    try {
      const clientId = parsePositiveInt(req.query['clientId']);
      const productId = parsePositiveInt(req.query['productId']);
      const verificationUnitId = parsePositiveInt(req.query['verificationUnitId']);
      const locationId = parsePositiveInt(req.query['locationId']);
      if (
        clientId === undefined ||
        productId === undefined ||
        verificationUnitId === undefined ||
        locationId === undefined
      )
        throw AppError.badRequest('BAD_REQUEST', {
          param: 'clientId, productId, verificationUnitId, locationId',
        });
      // ADR-0056: optional executive — when present the FIELD side is scoped to that assignee's commission.
      const assigneeRaw = req.query['assigneeId'];
      const assigneeId =
        typeof assigneeRaw === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeRaw)
          ? assigneeRaw
          : null;
      res.json(await svc.ratePreview(clientId, productId, verificationUnitId, locationId, assigneeId));
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

  async addTasks(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.addTasks(parseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async addApplicant(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.addApplicant(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },

  /** ADR-0024: the eligible pool for a not-yet-created task. ?visitType=FIELD|OFFICE (+ pincodeId &
   *  areaId for FIELD). The :id path keeps it symmetric with assignable-users; the pool itself is
   *  derived from the actor + visit type + location, not the case. */
  async eligibleAssignees(req: Request, res: Response, next: NextFunction) {
    try {
      parseId(req); // validate the case id shape (uuid) even though the pool is case-independent
      const visitType = req.query['visitType'];
      if (visitType !== 'FIELD' && visitType !== 'OFFICE')
        throw AppError.badRequest('BAD_REQUEST', { param: 'visitType' });
      res.json(
        await svc.eligibleAssignees(
          actor(req),
          visitType,
          parsePositiveInt(req.query['pincodeId']),
          parsePositiveInt(req.query['areaId']),
        ),
      );
    } catch (e) {
      next(e);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** Main cases-list export (IE-DEFER-3c / H-B3): re-runs the SAME scope-filtered list query — the
   *  export inherits the actor's case scope (Epic F). `current` = the exact page, `all` = the whole
   *  scoped set capped at the job threshold (413 above it). */
  async export(req: Request, res: Response, next: NextFunction) {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const { rows, columns } = await svc.exportData(q, ex, actor(req));
      await writeExport(res, {
        rows,
        columns,
        ex,
        filenameBase: 'cases',
        resource: 'cases',
        actorId: userId(req),
      });
    } catch (e) {
      next(e);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.get(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async assignableUsers(req: Request, res: Response, next: NextFunction) {
    try {
      // optional ?taskId= → per-task eligibility (visit-type pool ∩ hierarchy ∩ FIELD territory);
      // ?visitType= picks the pool (defaults FIELD in the service).
      const raw = req.query['taskId'];
      let taskId: string | undefined;
      if (raw !== undefined) {
        if (typeof raw !== 'string' || !UUID_RE.test(raw))
          throw AppError.badRequest('BAD_REQUEST', { param: 'taskId' });
        taskId = raw;
      }
      const vt = req.query['visitType'];
      const visitType = vt === 'OFFICE' ? 'OFFICE' : 'FIELD';
      res.json(await svc.assignableUsers(actor(req), taskId, visitType));
    } catch (e) {
      next(e);
    }
  },

  async assignTask(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res.json(await svc.assignTask(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async completeTask(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res.json(await svc.completeTask(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async recordTaskResult(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res.json(await svc.recordTaskResult(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async finalizeCase(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.finalizeCase(parseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** Case verdict history — every finalize (who/when/what), newest first (ADR-0033, case.view). */
  async verdictHistory(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.verdictHistory(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** Backend/office REVOKE a LIVE task — {ASSIGNED,IN_PROGRESS} → REVOKED (ADR-0033, task.revoke). */
  async revokeTask(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res.json(await svc.revokeTask(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** REVISIT a COMPLETED task — a new lineage-linked task that re-opens the case (ADR-0033, task.rework). */
  async revisitTask(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res.status(HTTP_STATUS.CREATED).json(await svc.revisitTask(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** REASSIGN-AFTER-REVOKE — dispatch a replacement for a REVOKED task (ADR-0033, task.rework). */
  async reassignTask(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const taskId = parseUuidParam(req, 'taskId');
      res
        .status(HTTP_STATUS.CREATED)
        .json(await svc.reassignRevokedTask(caseId, taskId, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  // ── Reference attachments (ADR-0025 B2) ──

  async listAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listAttachments(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async listFieldPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listFieldPhotos(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** On-view reverse-geocode of one field photo (ADR-0040; FIELD_PHOTO only, scope-guarded → 404). */
  async fieldPhotoAddress(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const attachmentId = parseUuidParam(req, 'attachmentId');
      res.json(await svc.resolveFieldPhotoAddress(caseId, attachmentId, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** GPS map-inset PNG for one field photo (ADR-0060) — proxied Google Static Maps, key server-side.
   *  404 when no coords / static maps unavailable → the web falls back to a coordinate placeholder. */
  async fieldPhotoStaticMap(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const attachmentId = parseUuidParam(req, 'attachmentId');
      const png = await svc.fieldPhotoStaticMap(caseId, attachmentId, actor(req));
      if (!png) throw AppError.notFound('STATIC_MAP_UNAVAILABLE');
      res.setHeader('content-type', 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(png);
    } catch (e) {
      next(e);
    }
  },

  /** Download ONE field photo (ADR-0060) — bytes + the canonical filename (server-set disposition). */
  async fieldPhotoDownload(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const attachmentId = parseUuidParam(req, 'attachmentId');
      const { bytes, filename, mimeType } = await svc.fieldPhotoDownload(caseId, attachmentId, actor(req));
      res.setHeader('content-type', mimeType);
      res.setHeader('content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  },

  /** Download ALL of a case's field photos as a zip (ADR-0060) — each entry canonically named. The
   *  scope-guarded list is resolved (may 404 NO_FIELD_PHOTOS) BEFORE any byte is streamed. */
  async fieldPhotosZip(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseId(req);
      const { zipName, files } = await svc.fieldPhotosZip(caseId, actor(req));
      res.setHeader('content-type', 'application/zip');
      res.setHeader('content-disposition', `attachment; filename="${zipName}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', next);
      archive.pipe(res);
      for (const f of files) archive.append(f.bytes, { name: f.filename });
      await archive.finalize();
    } catch (e) {
      next(e);
    }
  },

  /** Upload raw bytes (octet-stream body; original name in `x-filename`; optional `?taskId=`). */
  async uploadAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseId(req);
      const file = req.body as unknown;
      if (!Buffer.isBuffer(file) || file.length === 0)
        throw AppError.badRequest('NO_FILE', { hint: 'POST the file bytes as the body' });
      const fn = req.headers['x-filename'];
      const fileName = typeof fn === 'string' ? decodeURIComponent(fn) : 'attachment';
      const rawTask = req.query['taskId'];
      let taskId: string | undefined;
      if (rawTask !== undefined) {
        if (typeof rawTask !== 'string' || !UUID_RE.test(rawTask))
          throw AppError.badRequest('BAD_REQUEST', { param: 'taskId' });
        taskId = rawTask;
      }
      res
        .status(HTTP_STATUS.CREATED)
        .json(await svc.uploadAttachment(caseId, taskId, file, fileName, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async attachmentUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const attachmentId = parseUuidParam(req, 'attachmentId');
      res.json(await svc.attachmentUrl(caseId, attachmentId, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  async deleteAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = parseUuidParam(req, 'id');
      const attachmentId = parseUuidParam(req, 'attachmentId');
      await svc.deleteAttachment(caseId, attachmentId, actor(req));
      res.json({ deleted: true });
    } catch (e) {
      next(e);
    }
  },
};
