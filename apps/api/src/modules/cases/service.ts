import {
  DedupeQuerySchema,
  CreateCaseSchema,
  AddTasksSchema,
  AddApplicantSchema,
  AssignTaskSchema,
  CompleteTaskSchema,
  RecordTaskResultSchema,
  CaseFinalizeSchema,
  RevokeTaskSchema,
  ReworkTaskSchema,
  ReassignTaskSchema,
  CASE_STATUSES,
  type Case,
  type CaseApplicant,
  type CaseDetail,
  type CaseTaskView,
  type CaseVerdictEvent,
  type AvailableUnit,
  type DuplicateMatch,
  type CaseView,
  type Paginated,
  type AssignableUser,
  type CaseAttachment,
  type CaseFieldPhoto,
  type ReverseGeocodeResult,
} from '@crm2/sdk';
import { randomUUID, createHash } from 'node:crypto';
import { caseRepository as repo } from './repository.js';
import { emitTaskUpdate, emitCaseStatusUpdate } from './case-events.js';
import { geocodeService } from '../geocode/service.js';
import { geocodeConfigured } from '../../platform/geocode/index.js';
import { taskRepository } from '../tasks/repository.js';
import { AppError } from '../../platform/errors.js';
import { requireVersion } from '../../platform/occ.js';
import { resolvePage, resolveFilters, buildPage, type PageSpec } from '../../platform/pagination.js';
import { resolveScope, getScopedUserIds, type Actor } from '../../platform/scope/index.js';
import { getStorage } from '../../platform/storage/index.js';
import { detectAttachment, MAX_ATTACHMENT_BYTES } from '../../platform/file.js';
import { logger } from '@crm2/logger';
import type { NotifyInput } from '@crm2/sdk';
import { notificationService } from '../notifications/service.js';

/**
 * Notification producer (ADR-0027): fire-and-forget. A notification must NEVER break the core
 * mutation that triggered it — failures are logged, never thrown back to the assign/complete flow.
 */
function notifySafely(input: NotifyInput): void {
  notificationService.notify(input).catch((e: unknown) => {
    logger.warn('notification emit failed', {
      type: input.type,
      userId: input.userId,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}

/** Matches case_attachments.original_name varchar(255) — truncate an over-long client filename. */
const MAX_ATTACHMENT_NAME_LEN = 255;
import {
  assertExportable,
  exportThreshold,
  type ResolvedExport,
  type ExportColumn,
} from '../../platform/export/index.js';

/** Sortable columns (apiField → SQL column); only these reach ORDER BY. Filterable columns (§6/§7)
 *  are restricted to those in the COUNT query's FROM (cs + primary-applicant pa) — NOT cl/p, which
 *  the lean count does not join (client filtering stays the toolbar `clientId` domain filter). */
const CASE_PAGE_SPEC: PageSpec = {
  sortMap: {
    caseNumber: 'cs.case_number',
    status: 'cs.status',
    clientName: 'cl.name',
    productName: 'p.name',
    primaryName: 'pa.name',
    createdAt: 'cs.created_at',
    updatedAt: 'cs.updated_at',
  },
  filterMap: {
    caseNumber: { column: 'cs.case_number', kind: 'text' },
    primaryName: { column: 'pa.name', kind: 'text' },
    status: { column: 'cs.status', kind: 'enum', values: CASE_STATUSES },
  },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/** Standalone Dedupe Check page (dedupe.view) — same identifiers, paginated, cross-scope. The four
 *  identifiers ARE the search; there are no `f_*` column filters. Sort columns map to DEDUPE_SELECT. */
const DEDUPE_PAGE_SPEC: PageSpec = {
  sortMap: {
    caseNumber: 'cs.case_number',
    applicantName: 'a.name',
    companyName: 'a.company_name',
    status: 'cs.status',
    clientName: 'cl.name',
    createdAt: 'cs.created_at',
  },
  filterMap: {},
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
};

/** Export manifest — column ids match the Dedupe Check DataGrid (B-13 contract). */
const DEDUPE_EXPORT_COLUMNS: ExportColumn<DuplicateMatch>[] = [
  { id: 'caseNumber', header: 'Case', value: (r) => r.caseNumber },
  { id: 'applicantName', header: 'Applicant', value: (r) => r.applicantName },
  { id: 'companyName', header: 'Company', value: (r) => r.companyName },
  { id: 'mobile', header: 'Mobile', value: (r) => r.mobile },
  { id: 'pan', header: 'PAN', value: (r) => r.pan },
  { id: 'status', header: 'Status', value: (r) => r.status },
  { id: 'clientName', header: 'Client', value: (r) => r.clientName },
  { id: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { id: 'matchType', header: 'Matched On', value: (r) => r.matchType.join(', ') },
];

/** Pull the four dedupe identifiers out of a raw query and validate them (≥1 required, lenient
 *  2–50 char terms) via the shared schema → a ZodError surfaces as 400 VALIDATION. */
function dedupeIdentifiers(rawQuery: Record<string, unknown>) {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  return DedupeQuerySchema.parse({
    name: str(rawQuery['name']),
    mobile: str(rawQuery['mobile']),
    pan: str(rawQuery['pan']),
    company: str(rawQuery['company']),
  });
}

/**
 * Case service (Zion NewDataEntry flow): dedupe → create → add CPV-enabled units as tasks.
 *  - dedupe is advisory (returns matches; never blocks)
 *  - units must be CPV-enabled for the case's client+product, else 400 UNIT_NOT_ENABLED
 */
export const caseService = {
  dedupe(input: unknown): Promise<DuplicateMatch[]> {
    const q = DedupeQuerySchema.parse(input);
    return repo.searchDuplicates(q);
  },

  /** Standalone Dedupe Check page: paginated cross-case lookup (dedupe.view). NO scope predicate —
   *  a duplicate must be findable regardless of the actor's case scope (the dedicated perm is the gate). */
  async dedupeSearch(rawQuery: Record<string, unknown>): Promise<Paginated<DuplicateMatch>> {
    const q = dedupeIdentifiers(rawQuery);
    const r = resolvePage(rawQuery, DEDUPE_PAGE_SPEC);
    const { items, totalCount } = await repo.searchDuplicatesPaged(q, {
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(q)) if (v !== undefined) filters[k] = v;
    return buildPage(items, totalCount, r, filters);
  },

  /** Export the dedupe-search view (data.export): re-runs the same lookup. `current` = the page
   *  window; `all` = every match (capped by the job threshold). `selected` is N/A (read-only page). */
  async dedupeSearchExport(rawQuery: Record<string, unknown>, ex: ResolvedExport) {
    if (ex.mode === 'selected') return { rows: [], columns: DEDUPE_EXPORT_COLUMNS };
    const q = dedupeIdentifiers(rawQuery);
    const r = resolvePage(rawQuery, DEDUPE_PAGE_SPEC);
    const { items, totalCount } = await repo.searchDuplicatesPaged(q, {
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: ex.mode === 'current' ? r.limit : exportThreshold(),
      offset: ex.mode === 'current' ? r.offset : 0,
    });
    // A whole-set export ≥ the job threshold must 413 (IMPORT_EXPORT_STANDARD §2), like every list.
    if (ex.mode === 'all') assertExportable(totalCount);
    return { rows: items, columns: DEDUPE_EXPORT_COLUMNS };
  },

  create(input: unknown, userId: string): Promise<Case> {
    const v = CreateCaseSchema.parse(input);
    return repo.create(v, userId);
  },

  /** Add a co-applicant to an existing OPEN case (ADR-0053). Dedupe is advisory + captured per
   *  applicant (mirrors create). Allowed only while the case is NEW or IN_PROGRESS. */
  async addApplicant(caseId: string, input: unknown, userId: string): Promise<CaseApplicant> {
    const v = AddApplicantSchema.parse(input);
    const status = await repo.caseStatusOf(caseId);
    if (!status) throw AppError.notFound('CASE_NOT_FOUND');
    if (status !== 'NEW' && status !== 'IN_PROGRESS') throw AppError.conflict('CASE_NOT_OPEN');
    return repo.addApplicant(caseId, v, userId);
  },

  availableUnits(clientId: number, productId: number): Promise<AvailableUnit[]> {
    return repo.availableUnits(clientId, productId);
  },

  ratePreview(
    clientId: number,
    productId: number,
    verificationUnitId: number,
    locationId: number,
  ): Promise<{ clientRateType: string | null; fieldRateTypes: string[] }> {
    return repo.ratePreview(clientId, productId, verificationUnitId, locationId);
  },

  async addTasks(caseId: string, input: unknown, actor: Actor): Promise<CaseTaskView[]> {
    const cp = await repo.clientProductOf(caseId);
    if (!cp) throw AppError.notFound('CASE_NOT_FOUND');
    const v = AddTasksSchema.parse(input);
    // Every unit must be CPV-enabled for this client+product (distinct ids).
    const unitIds = v.tasks.map((t) => t.verificationUnitId);
    if (!(await repo.allUnitsEnabled(cp.clientId, cp.productId, unitIds)))
      throw AppError.badRequest('UNIT_NOT_ENABLED');
    // Every targeted applicant must belong to THIS case (no cross-case applicant leak).
    const owned = new Set(await repo.caseApplicantIds(caseId));
    if (v.tasks.some((t) => !owned.has(t.applicantId))) throw AppError.badRequest('INVALID_APPLICANT');
    // Assign-at-create (ADR-0024): re-check each chosen assignee server-side against the SAME pool the
    // FE offered — pool role for the visit type ∩ the actor's hierarchy ∩ (FIELD) the task territory.
    // The schema already guarantees assigneeId ⇒ visitType (+ FIELD ⇒ area+pincode).
    const assigned = v.tasks.filter((t) => t.assigneeId);
    if (assigned.length > 0) {
      const scopeUserIds = await getScopedUserIds(actor);
      for (const t of assigned) {
        const pool = await repo.eligibleAssigneesForNew(t.visitType!, t.pincodeId, t.areaId, scopeUserIds);
        if (!pool.some((u) => u.id === t.assigneeId)) throw AppError.badRequest('INVALID_ASSIGNEE');
      }
    }
    const created = await repo.addTasks(caseId, v.tasks, actor.userId);
    for (const t of created) emitTaskUpdate(t); // new tasks (incl. assign-at-create) appear live in the office
    return created;
  },

  /** The eligible pool for a not-yet-created task (ADR-0024): visit-type pool ∩ hierarchy ∩ (FIELD
   *  only) the chosen territory. case.assign-gated; scoped to the actor's hierarchy. */
  eligibleAssignees(
    actor: Actor,
    visitType: string,
    pincodeId: number | undefined,
    areaId: number | undefined,
  ): Promise<AssignableUser[]> {
    return getScopedUserIds(actor).then((ids) =>
      repo.eligibleAssigneesForNew(visitType, pincodeId, areaId, ids),
    );
  },

  async list(rawQuery: Record<string, unknown>, actor: Actor): Promise<Paginated<CaseView>> {
    const r = resolvePage(rawQuery, CASE_PAGE_SPEC);
    const statusRaw = rawQuery['status'];
    const status =
      typeof statusRaw === 'string' && (CASE_STATUSES as readonly string[]).includes(statusRaw)
        ? statusRaw
        : undefined;
    const clientIdRaw = Number(rawQuery['clientId']);
    const clientId = Number.isInteger(clientIdRaw) && clientIdRaw > 0 ? clientIdRaw : undefined;
    const columnFilters = resolveFilters(rawQuery, CASE_PAGE_SPEC);
    // Data scope (Epic F): restrict the visible cases to the actor's hierarchy. SUPER_ADMIN → no filter.
    const scope = await resolveScope(actor);
    const { items, totalCount } = await repo.list({
      ...(status !== undefined ? { status } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      ...(r.search !== undefined ? { search: r.search } : {}),
      columnFilters,
      scope,
      sortColumn: r.sortColumn,
      sortOrder: r.sortOrder,
      limit: r.limit,
      offset: r.offset,
    });
    const filters: Record<string, unknown> = {};
    if (status !== undefined) filters['status'] = status;
    if (clientId !== undefined) filters['clientId'] = clientId;
    if (r.search !== undefined) filters['search'] = r.search;
    for (const f of columnFilters) filters[`f_${f.field}`] = f.values.join(',');
    return buildPage(items, totalCount, r, filters);
  },

  async get(id: string, actor: Actor): Promise<CaseDetail> {
    // Data scope (Epic F): out-of-scope → 404 (indistinguishable from missing; IDOR-safe).
    const found = await repo.findById(id, await resolveScope(actor));
    if (!found) throw AppError.notFound('CASE_NOT_FOUND');
    return found;
  },

  /** Per-task eligibility (ADR-0024) when `taskId` is given — the chosen visit-type pool ∩ hierarchy
   *  ∩ (FIELD) the task's own territory; without it, the legacy whole-pool ∩ hierarchy. */
  async assignableUsers(actor: Actor, taskId?: string, visitType = 'FIELD'): Promise<AssignableUser[]> {
    if (taskId === undefined) return repo.assignableUsers(actor);
    const scope = await resolveScope(actor);
    const visible = await taskRepository.tasksForAssignment([taskId], scope);
    if (visible.length === 0) throw AppError.notFound('TASK_NOT_FOUND');
    return taskRepository.eligibleAssignees([taskId], visitType, await getScopedUserIds(actor));
  },

  async assignTask(caseId: string, taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = AssignTaskSchema.parse(input);
    const version = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    // Scope guard on the WRITE (IDOR): out-of-scope task ≡ missing → 404.
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'PENDING' && state.status !== 'ASSIGNED')
      throw AppError.conflict('TASK_NOT_ASSIGNABLE');
    // Eligibility (ADR-0024): the chosen visit-type pool ∩ actor hierarchy ∩ (FIELD) the task's
    // own territory — the SAME model as Add Task, so reassign and create agree.
    const eligible = await taskRepository.eligibleTaskIdsForAssignee(
      [taskId],
      v.assignedTo,
      v.visitType,
      await getScopedUserIds(actor),
    );
    if (eligible.length === 0) throw AppError.badRequest('INVALID_ASSIGNEE');
    const task = await repo.assignTask(caseId, taskId, v, actor.userId, version);
    // Producer (ADR-0027): tell the assignee a task is now theirs.
    if (task.assignedTo) {
      notifySafely({
        userId: task.assignedTo,
        // The field app auto-pulls a freshly-assigned task only on CASE_ASSIGNED/CASE_REASSIGNED
        // (NotificationService); v1 emitted CASE_ASSIGNED. Use it (already a valid enum member) so the
        // newly assigned task downloads immediately instead of waiting for the next full sync.
        type: 'CASE_ASSIGNED',
        title: 'New task assigned',
        body: `${task.taskNumber} · ${task.unitName}`,
        payload: { caseId, caseNumber: task.caseNumber, taskId, taskNumber: task.taskNumber },
        actionType: 'OPEN_TASK',
      });
    }
    emitTaskUpdate(task); // PENDING→ASSIGNED + case NEW→IN_PROGRESS → office views refetch live (ADR-0027)
    return task;
  },

  async unassignTask(caseId: string, taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const version = requireVersion(input);
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'ASSIGNED') throw AppError.conflict('TASK_NOT_ASSIGNED');
    const view = await repo.unassignTask(caseId, taskId, actor.userId, version);
    emitTaskUpdate(view); // ASSIGNED→PENDING → office views refetch live
    return view;
  },

  /** Finalize a task (ADR-0025/ADR-0047): record the official result + remark → COMPLETED. The generic
   *  completion leg — desk/KYC tasks finalize from ASSIGNED; field tasks from SUBMITTED (the field
   *  executive's submit); the same endpoint serves both. Scope-guarded (out-of-scope → 404),
   *  transition-guarded (else 409 INVALID_TRANSITION), OCC version-guarded. */
  async completeTask(caseId: string, taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = CompleteTaskSchema.parse(input);
    const version = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'ASSIGNED' && state.status !== 'SUBMITTED')
      throw AppError.conflict('INVALID_TRANSITION');
    const task = await repo.completeTask(caseId, taskId, v, actor.userId, version);
    // Producer (ADR-0027): tell the supervisor who dispatched it that it's finalized (skip self-complete).
    if (state.assignedBy && state.assignedBy !== actor.userId) {
      notifySafely({
        userId: state.assignedBy,
        type: 'TASK_COMPLETED',
        title: 'Task completed',
        body: `${task.taskNumber} · ${task.unitName} — ${task.verificationOutcome ?? ''}`.trim(),
        payload: { caseId, caseNumber: task.caseNumber, taskId, taskNumber: task.taskNumber },
        actionType: 'OPEN_TASK',
      });
    }
    emitTaskUpdate(task); // office complete → COMPLETED + case rollup → office views refetch live
    return task;
  },

  /** Record the per-task office result on an already-COMPLETED task (ADR-0032 D3). Scope-guarded
   *  (404), status-guarded (must be COMPLETED, else 409 — a not-yet-completed task uses `completeTask`),
   *  OCC version-guarded. Status is unchanged; the case verdict is recorded separately via finalize. */
  async recordTaskResult(
    caseId: string,
    taskId: string,
    input: unknown,
    actor: Actor,
  ): Promise<CaseTaskView> {
    const v = RecordTaskResultSchema.parse(input);
    const version = requireVersion(input);
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'COMPLETED') throw AppError.conflict('INVALID_TRANSITION');
    const view = await repo.recordTaskResult(
      caseId,
      taskId,
      v.result,
      v.remark ?? null,
      actor.userId,
      version,
    );
    emitTaskUpdate(view); // per-task office result recorded → case Review tab refreshes live (status unchanged)
    return view;
  },

  /** Case verdict history (ADR-0033): every finalize (who/when/what), newest first. Case-visibility
   *  guarded (out-of-scope → 404, IDOR-safe); gated `case.view` at the route. */
  async verdictHistory(caseId: string, actor: Actor): Promise<CaseVerdictEvent[]> {
    if (!(await repo.caseVisible(caseId, await resolveScope(actor))))
      throw AppError.notFound('CASE_NOT_FOUND');
    return repo.verdictHistory(caseId);
  },

  /** Backend/office REVOKE a LIVE task (ADR-0033, v1 parity): scope-guarded (out-of-scope → 404,
   *  IDOR-safe). The repo transition allows {ASSIGNED,IN_PROGRESS} → REVOKED (COMPLETED/PENDING → 409
   *  INVALID_TRANSITION; already-REVOKED idempotent). Reason mandatory. Gated `task.revoke` at the
   *  route. Shared DB transition with the device revoke — scope-bound here instead of ownership-bound. */
  async revokeTask(caseId: string, taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = RevokeTaskSchema.parse(input);
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    const view = await repo.revokeTaskInPlace(caseId, taskId, actor.userId, v.reason);
    emitTaskUpdate(view); // office REVOKED + case rollup → office views refetch live
    return view;
  },

  /** REVISIT a COMPLETED task (ADR-0033): scope-guarded (out-of-scope → 404, IDOR-safe), the parent
   *  must be COMPLETED (a live task is reassigned, a REVOKED one reassigned-after-revoke) else 409
   *  INVALID_TRANSITION. Blocks a second open revisit of the same parent (409 ACTIVE_REVISIT_EXISTS) —
   *  no duplicate follow-up/double-bill. Creates a NEW lineage-linked task that re-opens the case and
   *  invalidates the verdict. Gated `task.rework` (BACKEND_USER/MANAGER) at the route. */
  async revisitTask(caseId: string, taskId: string, input: unknown, actor: Actor): Promise<CaseTaskView> {
    const v = ReworkTaskSchema.parse(input);
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'COMPLETED') throw AppError.conflict('INVALID_TRANSITION');
    if (await repo.hasActiveRevisitOf(taskId)) throw AppError.conflict('ACTIVE_REVISIT_EXISTS');
    const view = await repo.revisitTask(caseId, taskId, actor.userId, v.reason ?? null);
    emitTaskUpdate(view); // REVISIT re-opens the case (new lineage task) → office views refetch live
    return view;
  },

  /** REASSIGN-AFTER-REVOKE (ADR-0033): the office dispatches a replacement for a REVOKED task.
   *  Scope-guarded (404), the parent must be REVOKED else 409 INVALID_TRANSITION. The chosen assignee
   *  is re-checked against the SAME pool as Add Task (visit-type pool ∩ hierarchy ∩ FIELD territory)
   *  → 400 INVALID_ASSIGNEE. Creates a NEW ASSIGNED replacement task. Gated `task.rework`. */
  async reassignRevokedTask(
    caseId: string,
    taskId: string,
    input: unknown,
    actor: Actor,
  ): Promise<CaseTaskView> {
    const v = ReassignTaskSchema.parse(input);
    const state = await repo.taskAssignmentState(caseId, taskId, await resolveScope(actor));
    if (!state) throw AppError.notFound('TASK_NOT_FOUND');
    if (state.status !== 'REVOKED') throw AppError.conflict('INVALID_TRANSITION');
    // Eligibility against the revoked task's OWN territory — the SAME path as a normal reassign
    // (visit-type pool ∩ hierarchy ∩ FIELD territory). The replacement clones that location.
    const eligible = await taskRepository.eligibleTaskIdsForAssignee(
      [taskId],
      v.assignedTo,
      v.visitType,
      await getScopedUserIds(actor),
    );
    if (eligible.length === 0) throw AppError.badRequest('INVALID_ASSIGNEE');
    const view = await repo.reassignRevokedTask(caseId, taskId, v, actor.userId);
    emitTaskUpdate(view); // replacement ASSIGNED task after revoke → office views refetch live
    return view;
  },

  /** Finalize a CASE (ADR-0032): record the ONE final verdict + optional remark → COMPLETED. The
   *  office decides this from the per-task office results. Case-grain scope-guarded (out-of-scope →
   *  404, IDOR-safe), transition-guarded (must be AWAITING_COMPLETION, else 409 INVALID_TRANSITION),
   *  OCC version-guarded. Returns the fresh case detail. */
  async finalizeCase(caseId: string, input: unknown, actor: Actor): Promise<CaseDetail> {
    const v = CaseFinalizeSchema.parse(input);
    const version = requireVersion(input); // OCC token (400 VERSION_REQUIRED)
    const scope = await resolveScope(actor);
    const state = await repo.caseFinalizeState(caseId, scope);
    if (!state) throw AppError.notFound('CASE_NOT_FOUND');
    if (state.status !== 'AWAITING_COMPLETION') throw AppError.conflict('INVALID_TRANSITION');
    await repo.finalizeCase(caseId, v.result, v.remark ?? null, actor.userId, version);
    const detail = await repo.findById(caseId, scope);
    if (!detail) throw AppError.internal('finalize: case vanished');
    emitCaseStatusUpdate(caseId, detail.caseNumber); // case → COMPLETED → MIS/dashboard refetch live
    return detail;
  },

  // ── Reference attachments (ADR-0025 B2; ADR-0021 storage) ──

  /** List the case's reference attachments the actor can reach (case-level + their reachable tasks). */
  async listAttachments(caseId: string, actor: Actor): Promise<CaseAttachment[]> {
    const scope = await resolveScope(actor);
    if (!(await repo.caseVisible(caseId, scope))) throw AppError.notFound('CASE_NOT_FOUND');
    return repo.listAttachments(caseId, scope);
  },

  /** Device field photos for the case (ADR-0034) — scope-guarded; images served via attachmentUrl. */
  async listFieldPhotos(caseId: string, actor: Actor): Promise<CaseFieldPhoto[]> {
    const scope = await resolveScope(actor);
    if (!(await repo.caseVisible(caseId, scope))) throw AppError.notFound('CASE_NOT_FOUND');
    return repo.listFieldPhotos(caseId, scope);
  },

  /** On-view reverse-geocode for ONE field photo (ADR-0040, FIELD_PHOTO only): a frozen/cached
   *  address returns immediately; otherwise resolve via the cache-first geocoder and write it through
   *  (freeze-safe). A missing key / Google miss / no-coords → null (UI degrades to raw coords). */
  async resolveFieldPhotoAddress(
    caseId: string,
    attachmentId: string,
    actor: Actor,
  ): Promise<ReverseGeocodeResult> {
    const scope = await resolveScope(actor);
    const row = await repo.fieldPhotoForGeocode(caseId, attachmentId, scope);
    if (!row) throw AppError.notFound('FIELD_PHOTO_NOT_FOUND');
    if (row.address) return { address: row.address, cached: true };
    const lat = row.geoLocation?.latitude;
    const lng = row.geoLocation?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return { address: null, cached: false };
    const res = await geocodeService.reverse(lat, lng);
    if (res.address === null) return { address: null, cached: false };
    return {
      address: await repo.setFieldPhotoReverseGeocodedAddress(attachmentId, res.address),
      cached: false,
    };
  },

  /** The async-on-upload worker processor (ADR-0040 Slice B; system job, NO actor scope). Idempotent:
   *  skips a vanished/already-frozen row; resolves via the cache-first geocoder + freeze-safe write.
   *  THROWS when the address is unresolved but a key IS configured → BullMQ retries → DLQ on exhaustion.
   *  When no key is configured it is a no-op (nothing to resolve; never dead-letters). */
  async reverseGeocodeFieldPhotoJob(job: { attachmentId: string; lat: number; lng: number }): Promise<void> {
    const existing = await repo.fieldPhotoAddressById(job.attachmentId);
    if (existing === undefined || existing) return; // gone, or already frozen → nothing to do
    const res = await geocodeService.reverse(job.lat, job.lng);
    if (res.address !== null) {
      await repo.setFieldPhotoReverseGeocodedAddress(job.attachmentId, res.address);
      return;
    }
    if (geocodeConfigured()) throw AppError.internal('GEOCODE_UNRESOLVED'); // transient → retry → DLQ
    // No key provisioned: degrade silently (the on-view fallback resolves once a key lands).
  },

  /** Upload an office reference document to a case (or a specific task). Bytes are sniffed by magic
   *  number (NOT the declared type), stored in object storage (ADR-0021) BEFORE the DB row so an
   *  unconfigured store is a clean 503 with no orphan row. */
  async uploadAttachment(
    caseId: string,
    taskId: string | undefined,
    bytes: Buffer,
    fileName: string,
    actor: Actor,
  ): Promise<CaseAttachment> {
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw AppError.badRequest('FILE_TOO_LARGE');
    const kind = detectAttachment(bytes);
    if (!kind) throw AppError.badRequest('UNSUPPORTED_FILE_TYPE');
    const scope = await resolveScope(actor);
    if (!(await repo.caseVisible(caseId, scope))) throw AppError.notFound('CASE_NOT_FOUND');
    if (taskId !== undefined && !(await repo.taskInCase(caseId, taskId)))
      throw AppError.notFound('TASK_NOT_FOUND');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `attachments/${caseId}/${randomUUID()}.${kind.ext}`;
    await getStorage().put(key, bytes, kind.type); // 503 STORAGE_NOT_CONFIGURED here, before any DB write
    return repo.insertAttachment(
      {
        caseId,
        taskId: taskId ?? null,
        originalName: fileName.slice(0, MAX_ATTACHMENT_NAME_LEN),
        mimeType: kind.type,
        fileSize: bytes.length,
        storageKey: key,
        sha256,
      },
      actor.userId,
    );
  },

  /** A short-lived signed URL to read an attachment (scope checked here; the URL is the only thing the
   *  client ever sees of the object store — IDOR-safe, the URL expires). */
  async attachmentUrl(caseId: string, attachmentId: string, actor: Actor): Promise<{ url: string }> {
    const found = await repo.attachmentForAccess(caseId, attachmentId, await resolveScope(actor));
    if (!found) throw AppError.notFound('ATTACHMENT_NOT_FOUND');
    return { url: await getStorage().signedUrl(found.storageKey) };
  },

  /** Soft-delete an attachment (scope checked) + best-effort remove the object. */
  async deleteAttachment(caseId: string, attachmentId: string, actor: Actor): Promise<void> {
    const found = await repo.attachmentForAccess(caseId, attachmentId, await resolveScope(actor));
    if (!found) throw AppError.notFound('ATTACHMENT_NOT_FOUND');
    await repo.softDeleteAttachment(attachmentId);
    await getStorage().remove(found.storageKey); // no-op-safe
  },
};
