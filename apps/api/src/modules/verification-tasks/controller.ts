import type { Request, Response, NextFunction } from 'express';
import { paramStr } from '../../http/params.js';
import { verificationTaskService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import type { Actor } from '../../platform/scope/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parseId = (req: Request): string => {
  const v = req.params['id'];
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return v;
};
const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

/** Field-execution controller (ADR-0032 slice 2c). `:id` = the task UUID (the locked contract id). */
export const verificationTaskController = {
  async start(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.start(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async complete(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.complete(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.revoke(parseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async setPriority(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.setPriority(parseId(req), req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async submitForm(req: Request, res: Response, next: NextFunction) {
    try {
      const formType = paramStr(req, 'formType');
      res.json(await svc.submitForm(parseId(req), formType, req.body, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** GET /:id/attachments — office reference docs for an owned task (mobile parity). */
  async listAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await svc.listAttachments(parseId(req), actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** GET /:id/attachments/:attachmentId — ONE office reference doc's bytes (the device's
   *  authenticated download path; its presigned-URL fetch is rejected by S3/MinIO mixed-auth). */
  async attachmentContent(req: Request, res: Response, next: NextFunction) {
    try {
      const attachmentId = req.params['attachmentId'];
      if (typeof attachmentId !== 'string' || !UUID_RE.test(attachmentId))
        throw AppError.badRequest('BAD_REQUEST', { param: 'attachmentId' });
      const { bytes, filename, mimeType } = await svc.attachmentContent(
        parseId(req),
        attachmentId,
        actor(req),
      );
      res.setHeader('content-type', mimeType);
      res.setHeader('content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  },

  /** DELETE /:id/attachments/:attachmentId — remove ONE of the field agent's OWN field photos on an
   *  open task (a bad capture, before submit). 204 on success; 404 (IDOR-safe) otherwise. */
  async deleteAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const attachmentId = req.params['attachmentId'];
      if (typeof attachmentId !== 'string' || !UUID_RE.test(attachmentId))
        throw AppError.badRequest('BAD_REQUEST', { param: 'attachmentId' });
      await svc.deleteFieldPhoto(parseId(req), attachmentId, actor(req));
      res.status(HTTP_STATUS.NO_CONTENT).end();
    } catch (e) {
      next(e);
    }
  },

  /** Device FIELD-PHOTO upload (ADR-0034): multer has parsed `files[]` into req.files and the text
   *  fields into req.body; the idempotency key rides the header (or `operationId` field). 200 on a new
   *  upload AND on a replay (the locked contract), never 201. */
  async uploadAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = (req.files as { buffer: Buffer; originalname: string; size: number }[] | undefined) ?? [];
      const files = raw.map((f) => ({ buffer: f.buffer, originalName: f.originalname, size: f.size }));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
      const idem = req.headers['idempotency-key'];
      res.json(
        await svc.uploadAttachments(
          parseId(req),
          files,
          {
            photoType: str(body['photoType']),
            operationId: str(body['operationId']),
            clientSha256: str(body['clientSha256']),
            geoLocation: str(body['geoLocation']),
            verificationType: str(body['verificationType']),
            submissionId: str(body['submissionId']),
          },
          typeof idem === 'string' ? idem : undefined,
          actor(req),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
};
