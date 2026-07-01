import { FIELD_REPORT_DEFAULTS, type FieldReportView } from '@crm2/sdk';
import { logger } from '@crm2/logger';
import { fieldReportRepository as repo, type TaskRenderContext } from './repository.js';
import { renderNarrative } from './render.js';
import { canonicalizeRenderContext } from './canonicalize.js';
import { buildSections } from './sections.js';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `field_reports.outcome` column width — the snapshot's outcome metadata is truncated to fit. */
const MAX_OUTCOME_LEN = 120;

/**
 * Resolve the FIELD_REPORT narrative from the built-in standard default for the verification type
 * (`FIELD_REPORT_DEFAULTS`, ADR-0079), rendered against the canonicalized context (codes → v1 verbose
 * labels, split → combined periods; read-time only, stored data untouched — ADR-0057). Admin-authored
 * `report_layouts` overrides were removed with the MIS/report-layout engine (ADR-0083). Returns null
 * for a non-field / KYC type with no standard default.
 */
function resolveNarrative(
  ctx: TaskRenderContext,
): { narrative: string; layoutId: number | null; layoutName: string | null } | null {
  const std = FIELD_REPORT_DEFAULTS[ctx.verificationType];
  if (!std) return null;
  // the default catalog is the write-shape (ReportLayoutColumnInput); read off the 3 fields the
  // renderer needs so the standard path matches the RenderColumn contract.
  const columns = std.columns.map((c) => ({
    columnKey: c.columnKey,
    sourceType: c.sourceType,
    sourceRef: c.sourceRef ?? null,
  }));
  return {
    narrative: renderNarrative(std.templateBody, columns, canonicalizeRenderContext(ctx)),
    layoutId: null,
    layoutName: `Standard ${ctx.verificationType}`,
  };
}

/** The device's submitted outcome (first form-type slug's `verificationOutcome`) — snapshot metadata. */
function deviceOutcome(formData: Record<string, unknown> | null): string | null {
  if (!formData) return null;
  for (const v of Object.values(formData)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = (v as Record<string, unknown>)['verificationOutcome'];
      if (typeof o === 'string' && o.trim()) return o.trim().slice(0, MAX_OUTCOME_LEN);
    }
  }
  return null;
}

/**
 * FIELD_REPORT service (ADR-0039/0079/0080). The per-task narrative is FROZEN at field submission
 * (`snapshot`) into `field_reports`; the read (`render`) returns that immutable snapshot when present,
 * else renders live. The load is scope-guarded (out-of-scope/absent/wrong-case → 404, IDOR-safe) and
 * gated `case.view` at the route.
 */
export const fieldReportService = {
  async render(caseId: string, taskId: string, actor: Actor): Promise<FieldReportView> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    if (!UUID_RE.test(taskId)) throw AppError.badRequest('BAD_REQUEST', { param: 'taskId' });
    const scope = await resolveScope(actor);
    const ctx = await repo.loadContext(caseId, taskId, scope);
    if (!ctx) throw AppError.notFound('TASK_NOT_FOUND');

    // Raw submitted fields — shown whether or not a narrative exists (the combined view, R1). Always
    // reflects the stored form_data (which is verbatim + immutable per task once submitted).
    const sections = buildSections(ctx.formData);

    // ADR-0080: a snapshot frozen at field submission WINS — the report never re-renders once submitted,
    // so a later template edit can't rewrite an already-submitted task's report.
    const snap = await repo.findSnapshot(taskId);
    if (snap) {
      return {
        taskId,
        verificationType: ctx.verificationType,
        sections,
        layoutId: snap.layoutId,
        layoutName: snap.layoutName,
        narrative: snap.narrative,
        snapshotAt: snap.renderedAt,
      };
    }

    // No snapshot (not yet submitted, or a task that predates snapshotting) → render live.
    const r = resolveNarrative(ctx);
    return {
      taskId,
      verificationType: ctx.verificationType,
      sections,
      layoutId: r?.layoutId ?? null,
      layoutName: r?.layoutName ?? null,
      narrative: r?.narrative ?? null,
      snapshotAt: null,
    };
  },

  /**
   * Freeze the field report at field submission (ADR-0080) — called by the device submit path AFTER the
   * form is stored and the task transitions. BEST-EFFORT: a render/store hiccup must NEVER fail the
   * agent's submission (the read path falls back to a live render when no snapshot exists). The caller
   * has already ownership-verified the task, so the context load is unscoped.
   */
  async snapshot(caseId: string, taskId: string, renderedBy: string): Promise<void> {
    try {
      const ctx = await repo.loadContext(caseId, taskId, undefined);
      if (!ctx) return;
      const r = resolveNarrative(ctx);
      if (!r) return; // a non-field / KYC type with no template → nothing to freeze
      await repo.upsertSnapshot({
        caseTaskId: taskId,
        verificationType: ctx.verificationType,
        outcome: deviceOutcome(ctx.formData),
        narrative: r.narrative,
        layoutId: r.layoutId,
        layoutName: r.layoutName,
        renderedBy,
      });
    } catch (e) {
      logger.warn('field report snapshot failed', {
        taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
};
