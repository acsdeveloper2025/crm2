import type { Request, Response, NextFunction } from 'express';
import { CASE_REPORT_FORMATS, type CaseReportFormat } from '@crm2/sdk';
import type { Actor } from '../../platform/scope/index.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { caseReportService } from './service.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

/** Parse + validate `?format=`; defaults to pdf (back-compat with the slice-2b button). */
const reportFormat = (req: Request): CaseReportFormat => {
  const raw = req.query['format'];
  if (raw === undefined) return 'pdf';
  if (typeof raw === 'string' && (CASE_REPORT_FORMATS as readonly string[]).includes(raw))
    return raw as CaseReportFormat;
  throw AppError.badRequest('BAD_REQUEST', { param: 'format' });
};

export const caseReportController = {
  /** GET /api/v2/cases/:id/report/preview — assembled `CaseReportContext` JSON for the renderers
   *  and admin Designer (ADR-0041 S5 slice 1). case.view at the route; scope-guarded → 404. */
  async preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params['id'] ?? '';
      res.json(await caseReportService.assemblePreview(caseId, actor(req)));
    } catch (e) {
      next(e);
    }
  },

  /** GET /api/v2/cases/:id/report.html — the rendered HTML report (ADR-0041 S5 slice 2a). The same
   *  HTML Puppeteer prints to PDF in slice 2b. case.view; scope-guarded → 404. Auto-escaped. */
  async html(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params['id'] ?? '';
      const html = await caseReportService.renderHtml(caseId, actor(req));
      // Defence-in-depth: the body is already escaped, but tell the browser not to MIME-sniff.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type('html').send(html);
    } catch (e) {
      next(e);
    }
  },

  /** POST /api/v2/cases/:id/report — enqueue a CASE_REPORT PDF job (ADR-0041 S5 slice 2b). case.view;
   *  scope-guarded → 404. Answers 202 + the PENDING JobView; the FE polls /jobs/:id and downloads via
   *  /jobs/:id/result-url (the shared job-tray pattern). */
  async enqueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caseId = req.params['id'] ?? '';
      const job = await caseReportService.enqueueReport(caseId, reportFormat(req), actor(req));
      res.status(HTTP_STATUS.ACCEPTED).json(job);
    } catch (e) {
      next(e);
    }
  },
};
