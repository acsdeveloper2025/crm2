import type { CaseReportFormat } from '@crm2/sdk';
import type { JobProcessor } from '../../platform/jobs/index.js';
import { getStorage } from '../../platform/storage/index.js';
import { htmlToPdf } from '../../platform/pdf/index.js';
import type { CaseReportJobPayload } from './types.js';
import { caseReportService } from './service.js';
import { renderCaseReportHtml, DEFAULT_PDF_PAGE_SIZE, DEFAULT_PDF_ORIENTATION } from './render.js';
import { renderCaseReportDocx } from './docx.js';
import { renderCaseReportXlsx } from './xlsx.js';

/**
 * CASE_REPORT job processor (ADR-0041 S5 slice 2b/4) — registered at boot (http/registerJobs), so the
 * platform jobs engine never imports this feature module. Runs on the worker tier (or in-process in
 * dev where REDIS_QUEUE_URL is unset). Assembles the context, then renders to the requested `format`
 * (pdf via Puppeteer over the auto-escaped HTML, or docx via the programmatic `docx` builder), stores
 * the artifact in object storage, and returns the pointer the jobs `resultUrl` serves as a presigned
 * download. ONE JobType (CASE_REPORT) parameterized by format — the tray + download path are shared.
 *
 * The actor (role + userId) rides in the payload — it is server-created at enqueue from req.auth, so
 * the worker re-resolves the SAME scope and the report contains only what that user may see.
 */
const stamp = (): string => new Date().toISOString().slice(0, 10).replace(/-/g, '');

const MIME: Record<CaseReportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const caseReportJobProcessor: JobProcessor = async (ctx) => {
  const { caseId, format, actor } = ctx.payload as CaseReportJobPayload;

  await ctx.progress(15, 'Assembling report');
  const { context, layoutBody } = await caseReportService.assemble(caseId, actor);

  await ctx.progress(60, `Generating ${format.toUpperCase()}`);
  const bytes =
    format === 'docx'
      ? await renderCaseReportDocx(context)
      : format === 'xlsx'
        ? await renderCaseReportXlsx(context)
        : await htmlToPdf(renderCaseReportHtml(context, layoutBody), {
            pageSize: context.layout?.pageSize ?? DEFAULT_PDF_PAGE_SIZE,
            orientation: context.layout?.pageOrientation ?? DEFAULT_PDF_ORIENTATION,
          });

  await ctx.progress(90, 'Uploading');
  const storageKey = `case-reports/${actor.userId}/${ctx.jobId}.${format}`;
  await getStorage().put(storageKey, bytes, MIME[format]);

  return {
    storageKey,
    filename: `report-${context.case.caseNumber}-${stamp()}.${format}`,
    caseId,
    format,
  };
};
