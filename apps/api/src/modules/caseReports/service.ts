import type {
  CaseReportContext,
  CaseReportTask,
  CaseReportPhoto,
  CaseReportFormat,
  PageSize,
  PageOrientation,
  JobView,
} from '@crm2/sdk';
import { AppError } from '../../platform/errors.js';
import { resolveScope, type Actor } from '../../platform/scope/index.js';
import { getStorage } from '../../platform/storage/index.js';
import { enqueue } from '../../platform/jobs/index.js';
import { caseRepository } from '../cases/repository.js';
import { fieldReportService } from '../fieldReports/service.js';
import { reportLayoutRepository } from '../reportLayouts/repository.js';
import { caseReportRepository } from './repository.js';
import { renderCaseReportHtml } from './render.js';
import type { CaseReportJobPayload } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MS_PER_DAY = 86_400_000;

/**
 * CASE_REPORT assembly engine (ADR-0041 S5 slice 1) — composes the `CaseReportContext` that the
 * renderers (slice 2 PDF / 4 docx / 5 xlsx) all run against.
 *
 * Boundaries it honours:
 *  - case.view at the route; scope-guarded → 404 IDOR-safe (relies on caseRepository.findById's scope).
 *  - Single-layer result (v2-by-design): reads case_tasks.verification_outcome / cases.verification_outcome
 *    directly — never an FE-only column.
 *  - FIELD_PHOTO only for photos (kind discriminator already on listPhotosForReport).
 *  - Plain-text narratives from the FIELD_REPORT engine flow through unchanged; renderers encode.
 */
export const caseReportService = {
  /** The JSON-preview contract (the renderers + admin Designer read this). */
  async assemblePreview(caseId: string, actor: Actor): Promise<CaseReportContext> {
    return (await assemble(caseId, actor)).context;
  },

  /** Render the case report as HTML (slice 2a) — the active CASE_REPORT layout body, or the built-in
   *  default when none is configured. Auto-escapes every context value (Security BLOCK-level). */
  async renderHtml(caseId: string, actor: Actor): Promise<string> {
    const { context, layoutBody } = await assemble(caseId, actor);
    return renderCaseReportHtml(context, layoutBody);
  },

  /** Context + resolved layout body in one pass — the CASE_REPORT job processor (slice 2b) needs both
   *  to render the PDF. Scope-guarded → throws CASE_NOT_FOUND (404) for an out-of-scope case. */
  assemble(caseId: string, actor: Actor): Promise<{ context: CaseReportContext; layoutBody: string | null }> {
    return assemble(caseId, actor);
  },

  /** Enqueue a CASE_REPORT job in the requested `format` (slice 2b pdf / slice 4 docx). Access is
   *  gated HERE (scope-404 IDOR-safe) so the user gets immediate feedback instead of a FAILED job; the
   *  worker re-resolves the SAME scope. Returns the PENDING tray row (202). */
  async enqueueReport(caseId: string, format: CaseReportFormat, actor: Actor): Promise<JobView> {
    if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
    const scope = await resolveScope(actor);
    if (!(await caseRepository.caseVisible(caseId, scope))) throw AppError.notFound('CASE_NOT_FOUND');
    const payload: CaseReportJobPayload = { caseId, format, actor };
    return enqueue('CASE_REPORT', payload, actor.userId);
  },
};

/** Assemble the context AND resolve the active CASE_REPORT layout body in one pass (so renderHtml
 *  needn't re-fetch the layout). Returns `layoutBody: null` when no CASE_REPORT layout is configured. */
async function assemble(
  caseId: string,
  actor: Actor,
): Promise<{ context: CaseReportContext; layoutBody: string | null }> {
  if (!UUID_RE.test(caseId)) throw AppError.badRequest('BAD_REQUEST', { param: 'caseId' });
  const scope = await resolveScope(actor);

  const detail = await caseRepository.findById(caseId, scope);
  if (!detail) throw AppError.notFound('CASE_NOT_FOUND');

  // 1) Per-task FIELD_REPORT narratives — reuses the existing engine (one render per task).
  const fieldReports = await Promise.all(
    detail.tasks.map((t) => fieldReportService.render(caseId, t.id, actor)),
  );

  // 2) Photos (scope-guarded) + presigned URLs in one pass. FIELD_PHOTOs are per-task by ADR-0034
  // (the device uploads them against a task); any row with task_id IS NULL is a data anomaly we
  // exclude so the math invariant Σ(task.photos.length) === totals.photoCount holds.
  const photoRows = (await caseReportRepository.listPhotosForReport(caseId)).filter((r) => r.taskId !== null);
  const storage = getStorage();
  const photosByTask = new Map<string, CaseReportPhoto[]>();
  for (const row of photoRows) {
    const url = await storage.signedUrl(row.storageKey);
    const photo: CaseReportPhoto = {
      id: row.id,
      photoType: row.photoType,
      url,
      latitude: typeof row.geoLocation?.latitude === 'number' ? row.geoLocation.latitude : null,
      longitude: typeof row.geoLocation?.longitude === 'number' ? row.geoLocation.longitude : null,
      accuracy: typeof row.geoLocation?.accuracy === 'number' ? row.geoLocation.accuracy : null,
      reverseGeocodedAddress: row.reverseGeocodedAddress,
      captureTime: row.geoLocation?.timestamp ?? null,
    };
    const taskId = row.taskId!;
    const bucket = photosByTask.get(taskId) ?? [];
    bucket.push(photo);
    photosByTask.set(taskId, bucket);
  }

  // 3) Compose per-task blocks.
  const tasks: CaseReportTask[] = detail.tasks.map((t, i) => {
    const fr = fieldReports[i]!;
    return {
      id: t.id,
      taskNumber: t.taskNumber,
      verificationType: t.unitCode,
      unitName: t.unitName,
      applicantName: t.applicantName,
      address: t.address,
      outcome: t.verificationOutcome,
      remark: t.remark,
      completedAt: t.completedAt,
      completedByName: t.completedByName,
      narrative: fr.narrative,
      sections: fr.sections,
      photos: photosByTask.get(t.id) ?? [],
    };
  });

  // 4) Totals (single-layer outcome counts).
  const totals = {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((t) => t.completedAt !== null).length,
    positiveTasks: tasks.filter((t) => t.outcome === 'POSITIVE').length,
    negativeTasks: tasks.filter((t) => t.outcome === 'NEGATIVE').length,
    referTasks: tasks.filter((t) => t.outcome === 'REFER').length,
    fraudTasks: tasks.filter((t) => t.outcome === 'FRAUD').length,
    photoCount: photoRows.length,
  };

  // 5) Active CASE_REPORT layout (null when none configured — renderer slice 2+ supplies a default).
  const layoutRow = await reportLayoutRepository.findActiveByConfig(
    detail.clientId,
    detail.productId,
    'CASE_REPORT',
  );
  const layout =
    layoutRow && layoutRow.pageSize && layoutRow.pageOrientation
      ? {
          id: layoutRow.id,
          name: layoutRow.name,
          pageSize: layoutRow.pageSize as PageSize,
          pageOrientation: layoutRow.pageOrientation as PageOrientation,
          version: layoutRow.version,
        }
      : null;

  // 6) TAT — completed minus created, in whole days; null when not completed.
  const tatDays =
    detail.completedAt && detail.createdAt
      ? Math.max(
          0,
          Math.round(
            (new Date(detail.completedAt).getTime() - new Date(detail.createdAt).getTime()) / MS_PER_DAY,
          ),
        )
      : null;

  // 7) Generation block (server time + the actor's name).
  const generatedByName = (await caseReportRepository.userName(actor.userId)) ?? 'Unknown';
  const primary = detail.applicants.find((a) => a.isPrimary) ?? detail.applicants[0] ?? null;

  const context: CaseReportContext = {
    case: {
      id: detail.id,
      caseNumber: detail.caseNumber,
      customerName: primary?.name ?? '',
      customerPhone: primary?.mobile ?? null,
      panNumber: primary?.pan ?? null,
      applicantType: primary?.applicantType ?? null,
      backendContactNumber: detail.backendContactNumber,
      status: detail.status,
      trigger: await caseReportRepository.caseTrigger(caseId),
      priority: detail.tasks[0]?.priority ?? null,
      receivedDate: detail.createdAt,
      completedDate: detail.completedAt,
      verificationOutcome: detail.verificationOutcome,
      resultRemark: detail.resultRemark,
      tatDays,
    },
    client: { id: detail.clientId, name: detail.clientName },
    product: { id: detail.productId, name: detail.productName },
    applicants: detail.applicants.map((a) => ({
      id: a.id,
      name: a.name,
      mobile: a.mobile,
      pan: a.pan,
      applicantType: a.applicantType,
      isPrimary: a.isPrimary,
    })),
    tasks,
    totals,
    generation: {
      generatedAt: new Date().toISOString(),
      generatedById: actor.userId,
      generatedByName,
    },
    layout,
  };
  return { context, layoutBody: layout ? (layoutRow?.templateBody ?? null) : null };
}
