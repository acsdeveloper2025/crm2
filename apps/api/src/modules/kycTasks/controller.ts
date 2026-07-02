import type { Request, Response, NextFunction } from 'express';
import { kycTasksService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { resolveExport, writeExport } from '../../platform/export/index.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  // routes are authorize()-guarded, so auth is always present here; fail closed if it ever isn't.
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const kycTasksController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await svc.list(req.query as Record<string, unknown>, actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async listAttachments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await svc.listAttachments(String(req.params['taskId'] ?? ''), actor(req)));
    } catch (e) {
      next(e);
    }
  },
  async attachmentUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(
        await svc.attachmentUrl(
          String(req.params['taskId'] ?? ''),
          String(req.params['attachmentId'] ?? ''),
          actor(req),
        ),
      );
    } catch (e) {
      next(e);
    }
  },
  async export(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = req.query as Record<string, unknown>;
      const ex = resolveExport(q);
      const a = actor(req);
      const { rows, columns, exportNo } = await svc.exportData(q, ex, a);
      // Filename = IST date-time + the export number (the batch's first event id) — quotable when the
      // verifier relays the file externally: kyc-tasks-20260702-1213-exp12.xlsx (owner 2026-07-02).
      const ist = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const part = (t: string): string => ist.find((p) => p.type === t)?.value ?? '';
      const stamp = `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}`;
      // cols: [] — the service already picked + expanded the columns (per-label detail columns are
      // NOT grid column ids, so writeExport's own selection must not re-filter them away).
      await writeExport(res, {
        rows,
        columns,
        ex: { ...ex, cols: [] },
        filenameBase: 'kyc-tasks',
        filename: `kyc-tasks-${stamp}-exp${exportNo}`,
        resource: 'kyc-tasks',
        actorId: a.userId,
      });
    } catch (e) {
      next(e);
    }
  },
};
