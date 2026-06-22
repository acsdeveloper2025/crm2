import type { FieldReportView } from '@crm2/sdk';
import { fieldReportRepository as repo } from './repository.js';
import { renderNarrative } from './render.js';
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
 * route. `narrative` is null when no template is configured for that verification type — a normal 200
 * answer, like a missing DATA_ENTRY layout.
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
    if (!layout || !layout.templateBody) {
      return {
        taskId,
        verificationType: ctx.verificationType,
        sections,
        layoutId: null,
        layoutName: null,
        narrative: null,
      };
    }

    return {
      taskId,
      verificationType: ctx.verificationType,
      sections,
      layoutId: layout.id,
      layoutName: layout.name,
      // Canonicalize the v2-native device payload (codes → v1 verbose labels, split → combined periods)
      // for the v1-vocabulary templates — read-time only, stored data untouched (ADR-0057).
      narrative: renderNarrative(layout.templateBody, layout.columns, canonicalizeRenderContext(ctx)),
    };
  },
};
