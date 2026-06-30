import { FIELD_REPORT_DEFAULTS, type FieldReportView } from '@crm2/sdk';
import { fieldReportRepository as repo } from './repository.js';
import { renderNarrative, type RenderColumn } from './render.js';
import { canonicalizeRenderContext } from './canonicalize.js';
import { buildSections } from './sections.js';
import { reportLayoutRepository } from '../reportLayouts/repository.js';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * FIELD_REPORT render service (ADR-0039) — renders the active FIELD_REPORT template for a task's
 * (client, product, verificationType) against its submitted form_data + case/applicant context. The
 * load is scope-guarded (out-of-scope/absent/wrong-case → 404, IDOR-safe) and gated `case.view` at the
 * route.
 *
 * Template resolution (most-specific → least-specific, v1 TemplateReportService parity):
 *  1. an admin-authored `report_layouts` row for this (client, product, verificationType) — overrides;
 *  2. else the built-in **standard** template for the verification type (`FIELD_REPORT_DEFAULTS`) — the
 *     same narratives v1 auto-generated, so the 9 field types produce their report with zero config;
 *  3. else `narrative: null` (a non-field/KYC type with no standard default) — a normal 200, like a
 *     missing DATA_ENTRY layout.
 */
export const fieldReportService = {
  async render(caseId: string, taskId: string, actor: Actor): Promise<FieldReportView> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    if (!UUID_RE.test(taskId)) throw AppError.badRequest('BAD_REQUEST', { param: 'taskId' });
    const scope = await resolveScope(actor);
    const ctx = await repo.loadContext(caseId, taskId, scope);
    if (!ctx) throw AppError.notFound('TASK_NOT_FOUND');

    // Raw submitted fields — shown whether or not a narrative template exists (the combined view, R1).
    const sections = buildSections(ctx.formData);

    const layout = await reportLayoutRepository.findActiveByConfig(
      ctx.clientId,
      ctx.productId,
      'FIELD_REPORT',
      ctx.verificationType,
    );
    // Canonicalize the v2-native device payload (codes → v1 verbose labels, split → combined periods)
    // for the v1-vocabulary templates — read-time only, stored data untouched (ADR-0057). Shared by
    // both the custom-layout and standard-default render paths.
    const render = (body: string, columns: RenderColumn[]): string =>
      renderNarrative(body, columns, canonicalizeRenderContext(ctx));

    // 1. Admin-authored layout for this (client, product, verificationType) — overrides.
    if (layout?.templateBody != null) {
      return {
        taskId,
        verificationType: ctx.verificationType,
        sections,
        layoutId: layout.id,
        layoutName: layout.name,
        narrative: render(layout.templateBody, layout.columns),
      };
    }

    // 2. Built-in standard default for the verification type (v1 TemplateReportService parity) — the
    //    9 field types produce their report with zero config; an admin layout above overrides it.
    const std = FIELD_REPORT_DEFAULTS[ctx.verificationType];
    if (std) {
      return {
        taskId,
        verificationType: ctx.verificationType,
        sections,
        layoutId: null,
        layoutName: `Standard ${ctx.verificationType}`,
        // the default catalog is the write-shape (ReportLayoutColumnInput); read off the 3 fields the
        // renderer needs so the standard and custom-layout paths share one RenderColumn contract.
        narrative: render(
          std.templateBody,
          std.columns.map((c) => ({
            columnKey: c.columnKey,
            sourceType: c.sourceType,
            sourceRef: c.sourceRef ?? null,
          })),
        ),
      };
    }

    // 3. Neither a custom layout nor a standard default (a non-field / KYC type) — narrative null.
    return {
      taskId,
      verificationType: ctx.verificationType,
      sections,
      layoutId: null,
      layoutName: null,
      narrative: null,
    };
  },
};
