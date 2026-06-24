import { z } from 'zod';
import type { SortOrder } from './pagination.js';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — Cases contract (ADR-0002 Case→Task→VerificationUnit). Models Zion's
 * single-page NewDataEntry: applicant + co-applicants, a search-first dedupe gate that
 * matches across ALL applicants, then create + add CPV-enabled units (with quantity) as
 * tasks. Mirrors migration 0010.
 */
/**
 * Case lifecycle (ADR-0032 two-track model). NEW → IN_PROGRESS once a task exists; rolls up to
 * AWAITING_COMPLETION when all non-revoked tasks are COMPLETED (the office then records the ONE
 * final verdict); COMPLETED is set ONLY by case.finalize (never auto) and is re-openable by a
 * revisit/recheck. REVOKED/CANCELLED are manual off-ramps. Mirrors chk_cases_status (migration 0052).
 */
export const CASE_STATUSES = [
  'NEW',
  'IN_PROGRESS',
  'AWAITING_COMPLETION',
  'COMPLETED',
  'REVOKED',
  'CANCELLED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Display labels for case statuses (UI maps UPPER_SNAKE → human text). */
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  AWAITING_COMPLETION: 'Awaiting Completion',
  COMPLETED: 'Completed',
  REVOKED: 'Revoked',
  CANCELLED: 'Cancelled',
};

/**
 * Task lifecycle (ADR-0047 two-stage completion). The field executive's submit lands the task in
 * SUBMITTED (their terminal; field commission frozen here); the office then adds report + official
 * result to reach COMPLETED (client bill). SUBMITTED replaces the retired SUBMITTED_FOR_REVIEW.
 * Mirrors chk_case_task_status (migration 0081).
 */
export const CASE_TASK_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'REVOKED',
  'CANCELLED',
] as const;
export type CaseTaskStatus = (typeof CASE_TASK_STATUSES)[number];

/** Display labels for task statuses (UI maps UPPER_SNAKE → human text). */
export const CASE_TASK_STATUS_LABELS: Record<CaseTaskStatus, string> = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  COMPLETED: 'Completed',
  REVOKED: 'Revoked',
  CANCELLED: 'Cancelled',
};

export const APPLICANT_TYPES = ['APPLICANT', 'CO_APPLICANT'] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

/** Per-task priority, dispatched to the field app (ADR-0023). */
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Visit type (ADR-0024): the operator-chosen assignment pool. FIELD = a field agent visits the
 * location; OFFICE = a desk verifier handles it. The eligible role for each is DATA
 * (`assignment_pool_roles`), not a literal — FE only shows these two choices + their labels.
 */
export const VISIT_TYPES = ['FIELD', 'OFFICE'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];
export const VISIT_TYPE_LABELS: Record<VisitType, string> = { FIELD: 'Field', OFFICE: 'Office' };

/** Field trip bands picked at a FIELD assignment (drive the executive commission). */
export const FIELD_RATE_TYPES = ['LOCAL', 'OGL'] as const;
export type FieldRateType = (typeof FIELD_RATE_TYPES)[number];

/** Full field-rate-type domain on the task/commission row: the FIELD bands + the desk `OFFICE` band
 *  (auto-stamped on OFFICE tasks; office commission is a flat rate, ADR-0050). */
export const COMMISSION_RATE_TYPES = ['LOCAL', 'OGL', 'OFFICE'] as const;
export type CommissionRateType = (typeof COMMISSION_RATE_TYPES)[number];

/**
 * Official verification result recorded at task completion (ADR-0025). One value per task,
 * set by the finalizing back-office user (the read-only KYC verifier never records it). Stored
 * UPPER_SNAKE; the UI maps to display labels.
 */
export const KYC_RESULTS = ['POSITIVE', 'NEGATIVE', 'REFER', 'FRAUD'] as const;
export type KycResult = (typeof KYC_RESULTS)[number];

/**
 * Task lineage origin (ADR-0033, ADR-0032 slice 3). ORIGINAL = created directly on the case;
 * REVISIT = a follow-up on a COMPLETED task (the client asked for more) — a new task linked to its
 * parent that re-opens the case and is billed SEPARATELY (the commission gate, slice 5, reads this).
 * A reassign-after-revoke replacement keeps the PARENT's origin (it is the redo of revoked work, not
 * additional scope). RECHECK was collapsed into REVISIT for v2 (KYC is a unit subtype, no separate
 * engine); a real distinction would re-add it.
 */
export const TASK_ORIGINS = ['ORIGINAL', 'REVISIT'] as const;
export type TaskOrigin = (typeof TASK_ORIGINS)[number];
export const TASK_ORIGIN_LABELS: Record<TaskOrigin, string> = {
  ORIGINAL: 'Original',
  REVISIT: 'Revisit',
};
export const KYC_RESULT_LABELS: Record<KycResult, string> = {
  POSITIVE: 'Positive',
  NEGATIVE: 'Negative',
  REFER: 'Refer',
  FRAUD: 'Fraud',
};

/**
 * Dedupe-gate outcome the operator records at create time (mandatory). NO_DUPLICATES_FOUND
 * when the search returned nothing; CREATE_NEW when duplicates existed but a new case is
 * justified (rationale then required). Recorded on the case for audit.
 */
export const DEDUPE_DECISIONS = ['NO_DUPLICATES_FOUND', 'CREATE_NEW'] as const;
export type DedupeDecision = (typeof DEDUPE_DECISIONS)[number];

export interface CaseApplicant {
  id: string;
  caseId: string;
  name: string;
  mobile: string | null;
  pan: string | null;
  /** Optional employer/company name — an identity field, also a dedupe key. */
  companyName: string | null;
  applicantType: ApplicantType;
  isPrimary: boolean;
  /** Auto-generated call-routing token (CC-<epoch>-<rand>); dispatched per task (ADR-0023). */
  callingCode: string;
  createdAt: string;
  /** ADR-0053: dedupe verdict for an applicant ADDED after creation. NULL/absent for the original
   *  set (whose dedupe is recorded on the case). */
  dedupeDecision?: DedupeDecision | null;
  dedupeRationale?: string | null;
  dedupeMatchedCaseNumbers?: string[];
}

export interface Case {
  id: string;
  caseNumber: string;
  clientId: number;
  productId: number;
  status: CaseStatus;
  /** Office contact the field agent calls — dispatched on every task (ADR-0023). */
  backendContactNumber: string;
  dedupeChecked: boolean;
  dedupeDecision: DedupeDecision;
  dedupeRationale: string | null;
  /** Case numbers this case matched but was created despite (CREATE_NEW); empty otherwise. */
  dedupeMatchedCaseNumbers: string[];
  /** The ONE FINAL case VERDICT (ADR-0032 D3) — office-authored at case.finalize, derived from the
   *  per-task office results; the column the client report prints. Null until the case is finalized. */
  verificationOutcome: KycResult | null;
  resultRemark: string | null;
  completedAt: string | null;
  /** OCC token (CONCURRENCY standard) — case.finalize requires it; 409 STALE_UPDATE on mismatch. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** List row: case + primary applicant identity + counts (denormalised via join). */
export interface CaseView extends Case {
  clientName: string;
  productName: string;
  primaryName: string;
  primaryMobile: string | null;
  primaryPan: string | null;
  /** Who recorded the final verdict (join on cases.completed_by); null until finalized. */
  completedByName: string | null;
  applicantCount: number;
  taskCount: number;
}

/** Realtime event name (office room, ADR-0027). Emitted when a task/case status changes — by a device
 *  action (start/complete/revoke/submit) or another office user (assign/complete/revoke/finalize) — so
 *  web views (case detail, pipeline, dashboard) refetch live instead of waiting for a manual reload. */
export const CASE_UPDATED_EVENT = 'case:updated';

/** Payload of {@link CASE_UPDATED_EVENT}. `caseId`/`caseNumber` are always present (the affected case);
 *  the task fields are present when a specific task transition triggered it (absent on case finalize). */
export interface CaseUpdateEvent {
  caseId: string;
  caseNumber: string;
  taskId?: string;
  taskNumber?: string;
  status?: CaseTaskStatus;
}

export interface CaseTaskView {
  id: string;
  caseId: string;
  /** Human case number `CASE-000000` (device + notifications display it; ADR-0023). */
  caseNumber: string;
  verificationUnitId: number;
  unitCode: string;
  unitName: string;
  /** The verification unit's kind (matches `KINDS` in verificationUnit.ts): FIELD_VISIT (address, field)
   *  vs KYC_DOCUMENT / DESK_DOCUMENT (desk). Lets a consumer tell a field task from a desk task without
   *  re-fetching the unit (e.g. the case-detail Field Report card shows FIELD_VISIT tasks only). */
  unitKind: 'FIELD_VISIT' | 'KYC_DOCUMENT' | 'DESK_DOCUMENT';
  /** Display task number `case_number-<seq>` (device shows it, never parses it; ADR-0023). */
  taskNumber: string;
  /** Lineage (ADR-0033): ORIGINAL, or REVISIT/RECHECK of `parentTaskId`. The commission gate reads it. */
  taskOrigin: TaskOrigin;
  /** The task this one reworks (set for REVISIT/RECHECK); null for ORIGINAL tasks. */
  parentTaskId: string | null;
  /** The applicant this task verifies; drives dispatched customerName/phone/callingCode/type. */
  applicantId: string;
  applicantName: string;
  /** Free-text dispatch address the field agent navigates to. */
  address: string;
  /** Bank instruction shown on the device as `notes`. */
  trigger: string;
  priority: Priority;
  status: CaseTaskStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  visitType: VisitType | null;
  fieldRateType: FieldRateType | null;
  billCount: number;
  /** Per-task verification location (ADR-0024) — FK to a `locations` (pincode, area) row; null for
   *  OFFICE tasks or tasks added without one. Drives field-agent territory match + rate resolution. */
  pincodeId: number | null;
  areaId: number | null;
  /** CLIENT rate type (LOCAL/OGL/OUTSTATION…) resolved from rate management for this case's
   *  client+product, the task's unit, and its location (area > pincode > default). Drives the client
   *  BILL — distinct from `fieldRateType` (the executive band that drives commission). Null when none. */
  clientRateType: string | null;
  assignedAt: string | null;
  /** When the field executive SUBMITTED the verification (ADR-0047) — the field terminal; field
   *  commission is frozen as-of this moment. Null until submitted. */
  submittedAt: string | null;
  /** Measured elapsed minutes assigned→submitted (ADR-0047), immutable once set; null until submitted. */
  submittedElapsedMinutes: number | null;
  /** Official result + completion (ADR-0025) — written only when the task reaches COMPLETED via the
   *  finalize endpoint; null on a not-yet-completed task. */
  verificationOutcome: KycResult | null;
  remark: string | null;
  completedAt: string | null;
  completedByName: string | null;
  /** Measured elapsed minutes assigned→completed (ADR-0044), immutable once set; null until completed. */
  completedElapsedMinutes: number | null;
  /** The TAT band the task was completed within (ADR-0044): the smallest active `tat_policies` band ≥
   *  the completed-in hours; -1 when elapsed overflows every band; null until completed. Derived at read. */
  completedTatBand: number | null;
  /** Per-task target TAT in hours (ADR-0044); null when no target is set. */
  tatHours: number | null;
  /** When the task is due — `assigned_at + tat_hours`; null until assigned or with no target. Derived at read. */
  dueAt: string | null;
  /** Target-TAT overdue (ADR-0044): an OPEN task whose `tat_hours` has elapsed since `assigned_at`. Derived at read. */
  overdue: boolean;
  /** OCC token (CONCURRENCY standard) — assignment + finalize writes require it; 409 STALE_UPDATE on mismatch. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** An executive eligible to be assigned a task, within the assigner's hierarchy scope. */
export interface AssignableUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

export interface CaseDetail extends CaseView {
  applicants: CaseApplicant[];
  tasks: CaseTaskView[];
}

/** A verification unit enabled (CPV) for a client+product — the case-creation unit picker. */
export interface AvailableUnit {
  verificationUnitId: number;
  code: string;
  name: string;
}

/** Rate-type preview for a chosen client+product+unit+location during task creation (ADR-0050): the
 *  CLIENT rate type mapped in Rate Management (drives the bill) and the FIELD rate type(s) configured in
 *  Commission Management at that location (drives the executive commission). Types only — no amounts. */
export interface RatePreview {
  /** client_rate_type of the rate resolved for this client+product+unit+location; null if none. */
  clientRateType: string | null;
  /** distinct field_rate_type values configured in active commission_rates at this location for this
   *  work context (LOCAL/OGL…); empty when no commission is configured there. */
  fieldRateTypes: string[];
}

/** Dedupe match (advisory): an applicant matching exactly on PAN, mobile, name, or company. */
export interface DuplicateMatch {
  caseId: string;
  caseNumber: string;
  applicantName: string;
  mobile: string | null;
  pan: string | null;
  companyName: string | null;
  status: CaseStatus;
  clientName: string;
  createdAt: string;
  matchType: string[];
}

const name = z.string().trim().min(1).max(200).transform(toUpper);
// Field validation rules (ADR-0023 hardening): PAN = ABCDE1234F (case-insensitive — the FE
// uppercases and dedupe matches case-insensitively); phone/contact = 10–15 digits only.
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
export const PHONE_REGEX = /^[0-9]{10,15}$/;
const mobile = z.string().trim().regex(PHONE_REGEX, 'Mobile must be 10–15 digits');
const pan = z.string().trim().regex(PAN_REGEX, 'PAN must be in the format ABCDE1234F');
const positiveInt = z.number().int().positive();
const MAX_ADDRESS = 500;
const MAX_TRIGGER = 2000;
const contactNumber = z.string().trim().regex(PHONE_REGEX, 'Contact number must be 10–15 digits');

/** Dedupe search — any subset of the four identifiers (exact match, OR-combined). Search terms are
 *  lenient (a partial/loose value is a valid search), NOT the strict create-time field rules. */
const searchTerm = z.string().trim().min(2).max(50);
const dedupeIdentifiers = {
  name: searchTerm.optional(),
  mobile: searchTerm.optional(),
  pan: searchTerm.optional(),
  company: searchTerm.optional(),
};
const atLeastOneIdentifier = (q: {
  name?: string | undefined;
  mobile?: string | undefined;
  pan?: string | undefined;
  company?: string | undefined;
}) => Boolean(q.name ?? q.mobile ?? q.pan ?? q.company);
const IDENTIFIER_REQUIRED = { message: 'provide at least one of name, mobile, pan, company' };

/** In-create dedupe gate query (POST /cases/dedupe) — returns a flat advisory array. */
export const DedupeQuerySchema = z
  .object(dedupeIdentifiers)
  .refine(atLeastOneIdentifier, IDENTIFIER_REQUIRED);
export type DedupeQuery = z.infer<typeof DedupeQuerySchema>;

/** Standalone Dedupe Check page query (GET /cases/dedupe-search) — same identifiers, paginated. */
export interface DedupeSearchQuery extends DedupeQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
}

const companyName = z.string().trim().max(200).transform(toUpper);
/** One applicant in a create request; index 0 is treated as the primary applicant. */
const applicantInput = z.object({
  name,
  mobile: mobile.optional(),
  pan: pan.optional(),
  companyName: companyName.optional(),
});

const MIN_RATIONALE = 5;
export const CreateCaseSchema = z
  .object({
    clientId: positiveInt,
    productId: positiveInt,
    // Office contact the field agent calls (ADR-0023). FE prefills from the creator's /me phone.
    backendContactNumber: contactNumber,
    applicants: z.array(applicantInput).min(1),
    dedupeDecision: z.enum(DEDUPE_DECISIONS),
    dedupeRationale: z.string().trim().max(2000).transform(toUpper).optional(),
    // The matched case numbers the operator created despite (recorded with the rationale).
    dedupeMatches: z.array(z.string().trim().max(20)).max(200).optional(),
    // Verification location (Epic F) — scopes a field agent by territory. A `locations` row id
    // (pincode = coarse, area = finer). Optional: a case without one is hierarchy/assignment-scoped only.
    pincodeId: positiveInt.optional(),
    areaId: positiveInt.optional(),
  })
  .refine((v) => v.dedupeDecision !== 'CREATE_NEW' || (v.dedupeRationale?.length ?? 0) >= MIN_RATIONALE, {
    message: 'a rationale is required when creating a new case despite duplicates',
    path: ['dedupeRationale'],
  });
export type CreateCaseInput = z.infer<typeof CreateCaseSchema>;

/** Add ONE applicant (always a co-applicant) to an existing case, with its own dedupe verdict
 *  (ADR-0053). Mirrors the create-case dedupe contract for a single applicant. */
export const AddApplicantSchema = z
  .object({
    name,
    mobile: mobile.optional(),
    pan: pan.optional(),
    companyName: companyName.optional(),
    dedupeDecision: z.enum(DEDUPE_DECISIONS),
    dedupeRationale: z.string().trim().max(2000).transform(toUpper).optional(),
    dedupeMatches: z.array(z.string().trim().max(20)).max(200).optional(),
  })
  .refine((v) => v.dedupeDecision !== 'CREATE_NEW' || (v.dedupeRationale?.length ?? 0) >= MIN_RATIONALE, {
    message: 'a rationale is required when adding an applicant despite duplicates',
    path: ['dedupeRationale'],
  });
export type AddApplicantInput = z.infer<typeof AddApplicantSchema>;

const MAX_TASKS = 50;
/**
 * Add tasks to a case (ADR-0023). Each task is an explicit spec — a CPV-enabled unit, the
 * applicant it verifies, its dispatch address, the bank trigger, and a priority. (Replaces the
 * old unit×quantity shape: quantity is now "add N task rows", each independently dispatchable.)
 */
export const AddTasksSchema = z.object({
  tasks: z
    .array(
      z
        .object({
          verificationUnitId: positiveInt,
          applicantId: z.string().uuid(),
          // Required for a visit; OFFICE/desk (incl. KYC document) tasks have no address → may be blank.
          address: z.string().trim().max(MAX_ADDRESS).transform(toUpper).default(''),
          // Optional dispatch coordinates for the task's address (v1 parity) — provided by the case
          // feed/create when known, emitted to the field app; null otherwise.
          latitude: z.number().gte(-90).lte(90).optional(),
          longitude: z.number().gte(-180).lte(180).optional(),
          trigger: z.string().trim().max(MAX_TRIGGER).transform(toUpper).default(''),
          priority: z.enum(PRIORITIES).default('MEDIUM'),
          // Target TAT in hours (ADR-0044). Optional override; omitted → derived from priority server-side
          // (URGENT 4 · HIGH 8 · MEDIUM 24 · LOW 48). Additive — mobile (ADR-0012) is unaffected.
          tatHours: z.number().int().positive().optional(),
          // ADR-0024: optional assign-at-create. visitType picks the pool (FIELD/OFFICE); a FIELD
          // task carries its location (areaId/pincodeId) for territory match + rate resolution;
          // assigneeId assigns it immediately (server re-checks eligibility) — omit all to add it PENDING.
          visitType: z.enum(VISIT_TYPES).optional(),
          // ADR-0056: field_rate_type is normally server-derived from the assignee's commission (the web
          // no longer picks it). An explicit value is honored for back-compat; a FIELD assign with neither
          // an explicit value NOR a matching commission at the location is blocked (NO_FIELD_COMMISSION).
          fieldRateType: z.enum(FIELD_RATE_TYPES).optional(),
          pincodeId: positiveInt.optional(),
          areaId: positiveInt.optional(),
          assigneeId: z.string().uuid().optional(),
        })
        // Address is the visit location — required only for a FIELD visit. OFFICE/desk tasks have none,
        // and an unassigned (assign-later) task gets its address when it is later dispatched as FIELD.
        .refine((t) => t.visitType !== 'FIELD' || t.address.length >= 1, {
          message: 'address is required for a FIELD task',
          path: ['address'],
        })
        .refine((t) => !t.assigneeId || !!t.visitType, {
          message: 'visitType is required when assigning at creation',
          path: ['visitType'],
        })
        .refine((t) => !t.assigneeId || t.visitType !== 'FIELD' || (!!t.areaId && !!t.pincodeId), {
          message: 'a FIELD assignment requires the verification location (pincode + area)',
          path: ['areaId'],
        }),
    )
    .min(1)
    .max(MAX_TASKS),
});
// z.input (not z.infer/output): trigger + priority have defaults, so callers may omit them.
export type AddTasksInput = z.input<typeof AddTasksSchema>;

/** Query for the eligible-assignee pool of a not-yet-created task (ADR-0024): the chosen visit type,
 *  plus the location for a FIELD pick (territory match). OFFICE ignores location. */
export interface EligibleAssigneesQuery {
  visitType: VisitType;
  pincodeId?: number;
  areaId?: number;
}

const uuid = z.string().uuid();
const MAX_BILL_COUNT = 50;

/** Assign (or reassign) a task to an executive: the visit-type pool + bill count. The OCC `version`
 *  travels OUTSIDE this schema (requireVersion → 400). ADR-0056: the executive-commission key
 *  `field_rate_type` (LOCAL/OGL) is normally NOT picked here — the server derives it from the assignee's
 *  commission at the task location and BLOCKS a FIELD assign with no commission there. An explicit value
 *  is honored for back-compat; OFFICE auto-stamps 'OFFICE' regardless. */
export const AssignTaskSchema = z.object({
  assignedTo: uuid,
  visitType: z.enum(VISIT_TYPES),
  fieldRateType: z.enum(FIELD_RATE_TYPES).optional(),
  billCount: z.number().int().min(0).max(MAX_BILL_COUNT),
});
export type AssignTaskInput = z.infer<typeof AssignTaskSchema>;

/** The wire shape of a versioned assignment write (input + the OCC token). */
export type AssignTaskRequest = AssignTaskInput & { version: number };

const MAX_REMARK = 2000;

/** Finalize a task (ADR-0025): the official result + a mandatory remark. Gated `field_review.complete`
 *  (the read-only verifier cannot call it). OCC `version` travels OUTSIDE the schema (requireVersion). */
export const CompleteTaskSchema = z.object({
  result: z.enum(KYC_RESULTS),
  remark: z.string().trim().min(1).max(MAX_REMARK),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;
export type CompleteTaskRequest = CompleteTaskInput & { version: number };

/**
 * Record the per-task office RESULT on an already-COMPLETED task (ADR-0032 D3). A field task is
 * completed by the device with NO result (single-layer); the office then records its official result
 * here (status stays COMPLETED). These per-task results are the "reports for all tasks" the office
 * derives the ONE final case verdict from (case.finalize). Gated `field_review.complete`; remark
 * optional. OCC `version` travels OUTSIDE the schema (requireVersion).
 */
export const RecordTaskResultSchema = z.object({
  result: z.enum(KYC_RESULTS),
  remark: z.string().trim().max(MAX_REMARK).optional(),
});
export type RecordTaskResultInput = z.infer<typeof RecordTaskResultSchema>;
export type RecordTaskResultRequest = RecordTaskResultInput & { version: number };

/**
 * Finalize a CASE (ADR-0032): record the ONE FINAL verdict + an optional case-level remark and close
 * the case (AWAITING_COMPLETION → COMPLETED). The office decides this from the per-task office results.
 * Gated `case.finalize` (BACKEND_USER/SA). OCC `version` travels OUTSIDE the schema (requireVersion).
 */
export const CaseFinalizeSchema = z.object({
  result: z.enum(KYC_RESULTS),
  remark: z.string().trim().max(MAX_REMARK).optional(),
});
export type CaseFinalizeInput = z.infer<typeof CaseFinalizeSchema>;
export type CaseFinalizeRequest = CaseFinalizeInput & { version: number };

/**
 * One entry in a case's verdict history (ADR-0033) — every `finalize` of the case, newest first,
 * derived from the append-only audit log. A revisit re-opens the case and the office re-finalizes, so
 * the history shows the before/after verdict (e.g. an original REFER then a post-revisit POSITIVE).
 */
export interface CaseVerdictEvent {
  result: KycResult;
  remark: string | null;
  /** ISO timestamp the verdict was recorded. */
  at: string;
  /** The office user who finalized; null if the actor is no longer resolvable. */
  actorName: string | null;
}

/**
 * Backend/office REVOKE a LIVE task (ADR-0033, v1 parity): {ASSIGNED,IN_PROGRESS} → REVOKED with a
 * mandatory reason (stored on the task remark). A COMPLETED task CANNOT be revoked (it is reworked via
 * revisit); a PENDING one is unassigned instead. Gated `task.revoke` (BACKEND_USER/MANAGER). The same
 * DB transition the device uses on its own assigned task — scope-bound here, no OCC version.
 */
export const RevokeTaskSchema = z.object({
  reason: z.string().trim().min(1).max(MAX_REMARK),
});
export type RevokeTaskInput = z.infer<typeof RevokeTaskSchema>;

/**
 * REVISIT a COMPLETED task (ADR-0033, ADR-0032 slice 3): the client asked for more after delivery →
 * create a NEW task cloning the parent's targeting and linking back to it (lineage), re-opening the
 * case (→ IN_PROGRESS) and invalidating the verdict. The parent must be COMPLETED (a live task is
 * reassigned, a REVOKED one is reassigned-after-revoke). Billed separately. The optional reason rides
 * the audit row. Gated `task.rework` (BACKEND_USER/MANAGER). The new task is born PENDING (dispatched
 * via the normal assign flow).
 */
export const ReworkTaskSchema = z.object({
  reason: z.string().trim().max(MAX_REMARK).optional(),
});
export type ReworkTaskInput = z.infer<typeof ReworkTaskSchema>;

/**
 * REASSIGN-AFTER-REVOKE (ADR-0033, ADR-0032 slice 3): a field user REVOKED their task; the office
 * dispatches a REPLACEMENT task (a new row cloning the revoked task's CPV + applicant + address +
 * location, born ASSIGNED to the chosen executive, lineage-linked, keeping the parent's origin — NO
 * extra bill). The operator re-picks the pool (visit type), assignee, and bill — the SAME fields as an
 * assignment (location stays the task's, as in v2 assign) + an optional reason. Gated `task.rework`.
 */
export const ReassignTaskSchema = z.object({
  assignedTo: uuid,
  visitType: z.enum(VISIT_TYPES),
  // ADR-0056: normally server-derived from the assignee's commission; an explicit value is honored.
  fieldRateType: z.enum(FIELD_RATE_TYPES).optional(),
  billCount: z.number().int().min(0).max(MAX_BILL_COUNT),
  reason: z.string().trim().max(MAX_REMARK).optional(),
});
export type ReassignTaskInput = z.infer<typeof ReassignTaskSchema>;

/**
 * An office-uploaded reference attachment (ADR-0025 B2) — a document (PDF/image) a back-office user
 * attaches to a case or a specific task for the assignee (field agent OR KYC verifier) to read. This
 * is the metadata; bytes live in object storage (ADR-0021), read via a short-lived signed URL.
 * `taskId` null = case-level reference; set = the task it belongs to. NOT field photo-capture.
 */
export interface CaseAttachment {
  id: string;
  caseId: string;
  taskId: string | null;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedByName: string | null;
  createdAt: string;
}

/** A device field photo (ADR-0034, kind=FIELD_PHOTO) for the case-detail Field Photos card. The image
 *  is fetched via the existing GET /cases/:id/attachments/:attachmentId/url presigned route. */
export interface CaseFieldPhoto {
  id: string;
  taskId: string | null;
  unitName: string | null;
  photoType: string | null;
  originalName: string;
  geoLocation: { latitude?: number; longitude?: number; accuracy?: number; timestamp?: string } | null;
  /** The frozen server-side reverse-geocoded address, or null until resolved (FIELD_PHOTO only).
   *  When null, the #7 gallery lazily resolves it via cases.fieldPhotoAddress (on-view fallback). */
  reverseGeocodedAddress: string | null;
  createdAt: string;
}
