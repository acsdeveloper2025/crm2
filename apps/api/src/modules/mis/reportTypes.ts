import type { FilterField } from '../../platform/pagination.js';
import { RATE_LATERAL, COMMISSION_LATERAL } from '../../platform/billing/laterals.js';
import { BILLABLE_STATUS_SQL, COMMISSIONABLE_STATUS_SQL } from '../../platform/billing/status.js';

/**
 * MIS report-type registry (ADR-0084). Report types + their column allow-lists are CODE, not DB
 * config — the removed engine's `source_type → SQL` grammar (the injection boundary) is gone. Each
 * column's `sql` is a CONSTANT expression the repository aliases to `key`; only the SET of selected
 * keys varies per request, and keys are validated against this registry (unknown → 400). Money
 * columns (`money: true`) reference the billing laterals (`rt`/`com`) and are projected + joined ONLY
 * for actors with billing.view; they are deliberately never sortable/filterable (no ordering/bisection
 * oracle). 1-to-many relations (assignment history, co-applicants, attachments) are intentionally
 * absent — every column below lives on a 1:1 join or a scalar of the task row, so no row fans out.
 *
 * Keys are camelCase: the API camelizes response object keys (additive-camelize contract), so the
 * SQL alias (`AS "caseNumber"`), the catalog key, the `cols`/`sortBy`/`f_<key>` params, and the row
 * key all line up (camelize is a no-op on an already-camel key).
 */

export type MisDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';

export interface MisColumn {
  key: string;
  label: string;
  group: string;
  dataType: MisDataType;
  /** CONSTANT SQL SELECT expression, aliased to `key`. Never built from request input. */
  sql: string;
  money?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  /** filter matching for a filterable column; defaults by dataType (TEXT→text, SELECT→code, DATE→date). */
  filterKind?: FilterField['kind'];
  defaultVisible?: boolean;
}

export interface MisReportType {
  type: string;
  label: string;
  /** row grain: 'task' = one row per case_task; 'case' = one row per case (rollups + money subqueries). */
  grain: 'task' | 'case';
  columns: MisColumn[];
  /** default sort column key — MUST be a sortable, non-money column. */
  defaultSort: string;
}

type ColOpts = Omit<MisColumn, 'key' | 'label' | 'group' | 'dataType' | 'sql'>;
const col = (
  key: string,
  label: string,
  group: string,
  dataType: MisDataType,
  sql: string,
  opts: ColOpts = {},
): MisColumn => ({ key, label, group, dataType, sql, ...opts });

/**
 * TASK_OPERATIONAL — one row per verification task (case_tasks), the operational workhorse. Case-level
 * columns present here are 1:1 CONTEXT scalars (never summed); case-level rollups/counts live on the
 * separate case-grain report type (a later slice), so nothing double-counts.
 * FROM aliases: ct=case_tasks, cs=cases, vu=verification_units, cl=clients, p=products,
 * au=users(assigned_to), ta=case_applicants(task applicant), fr=field_reports, frt=rate_types,
 * rt=RATE_LATERAL, com=COMMISSION_LATERAL.
 */
const TASK_OPERATIONAL: MisReportType = {
  type: 'TASK_OPERATIONAL',
  label: 'Operational Case / Task MIS',
  grain: 'task',
  defaultSort: 'taskCreatedAt',
  columns: [
    // Case context (1:1)
    col('caseNumber', 'Case Number', 'Case', 'TEXT', 'cs.case_number', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('clientName', 'Client', 'Case', 'TEXT', 'cl.name', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('productName', 'Product', 'Case', 'TEXT', 'p.name', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('caseStatus', 'Case Status', 'Case', 'SELECT', 'cs.status', { filterable: true }),
    col('caseVerdict', 'Case Verdict', 'Case', 'SELECT', 'cs.verification_outcome', { filterable: true }),
    col('caseResultRemark', 'Case Result Remark', 'Case', 'TEXT', 'cs.result_remark'),
    col('backendContactNumber', 'Office Contact', 'Case', 'TEXT', 'cs.backend_contact_number'),
    col('caseCreatedAt', 'Case Created', 'Case', 'DATE', 'cs.created_at', {
      sortable: true,
      filterable: true,
    }),
    col('caseCompletedAt', 'Case Completed', 'Case', 'DATE', 'cs.completed_at', {
      sortable: true,
      filterable: true,
    }),
    // Task applicant (1:1 via ct.applicant_id)
    col('applicantName', 'Applicant', 'Applicant', 'TEXT', 'ta.name', {
      filterable: true,
      defaultVisible: true,
    }),
    col('applicantMobile', 'Mobile', 'Applicant', 'TEXT', 'ta.mobile', {
      filterable: true,
      defaultVisible: true,
    }),
    col('applicantPan', 'PAN', 'Applicant', 'TEXT', 'ta.pan', { filterable: true, defaultVisible: true }),
    col('applicantCompany', 'Company', 'Applicant', 'TEXT', 'ta.company_name'),
    col('applicantType', 'Applicant Type', 'Applicant', 'SELECT', 'ta.applicant_type', { filterable: true }),
    col('callingCode', 'Calling Code', 'Applicant', 'TEXT', 'ta.calling_code'),
    // Task (1:1)
    col('taskNumber', 'Task Number', 'Task', 'TEXT', 'ct.task_number', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('taskStatus', 'Task Status', 'Task', 'SELECT', 'ct.status', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('taskVerificationOutcome', 'Task Result', 'Task', 'SELECT', 'ct.verification_outcome', {
      filterable: true,
      defaultVisible: true,
    }),
    col('taskRemark', 'Task Remark', 'Task', 'TEXT', 'ct.remark'),
    col('visitType', 'Visit Type', 'Task', 'SELECT', 'ct.visit_type', { filterable: true }),
    col('taskOrigin', 'Origin', 'Task', 'SELECT', 'ct.task_origin', { filterable: true }),
    col('priority', 'Priority', 'Task', 'SELECT', 'ct.priority', { sortable: true, filterable: true }),
    col('dispatchAddress', 'Dispatch Address', 'Task', 'TEXT', 'ct.address'),
    col('trigger', 'Bank Instruction', 'Task', 'TEXT', 'ct.trigger'),
    col('latitude', 'Latitude', 'Task', 'NUMBER', 'ct.latitude::float8'),
    col('longitude', 'Longitude', 'Task', 'NUMBER', 'ct.longitude::float8'),
    col('taskCreatedAt', 'Task Created', 'Task', 'DATE', 'ct.created_at', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('startedAt', 'Started At', 'Task', 'DATE', 'ct.started_at', { sortable: true }),
    // Verification unit / CPV (1:1)
    col('unitName', 'Verification Unit', 'Unit / CPV', 'TEXT', 'vu.name', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('unitCode', 'Unit Code', 'Unit / CPV', 'TEXT', 'vu.code', { filterable: true }),
    col('unitCategory', 'Unit Category', 'Unit / CPV', 'SELECT', 'vu.category', { filterable: true }),
    // NB: verification_units.kind was dropped (ADR-0070, mig 0097) — worker_role is the discriminator.
    col('workerRole', 'Worker Role', 'Unit / CPV', 'SELECT', 'vu.worker_role', { filterable: true }),
    col('requiredPhotos', 'Required Photos', 'Unit / CPV', 'NUMBER', 'vu.required_photos'),
    col('piiSensitive', 'PII Sensitive', 'Unit / CPV', 'BOOLEAN', 'vu.pii_sensitive'),
    col('billCount', 'Bill Count', 'Unit / CPV', 'NUMBER', 'ct.bill_count', {
      sortable: true,
      defaultVisible: true,
    }),
    // Rate type (codes — NOT money)
    col('fieldRateType', 'Field Rate Type', 'Rate & Money', 'TEXT', 'frt.code', {
      filterable: true,
      filterKind: 'code',
      defaultVisible: true,
    }),
    col('rateTypeName', 'Rate Type Name', 'Rate & Money', 'TEXT', 'frt.name'),
    col('rateTypeCategory', 'Rate Type Category', 'Rate & Money', 'SELECT', 'frt.category'),
    // Money (billing.view-gated; laterals joined only when allowed; never sortable/filterable).
    // Status-gated to the SHARED money-status rule (platform/billing/status.ts) so a non-billable task
    // (REVOKED/PENDING/…) shows NULL, never a phantom bill/commission — the report footer already filtered
    // the same way, and these per-row columns had drifted un-gated (§REVOKE-BILLING, prod CASE-000004).
    col(
      'billAmount',
      'Bill Amount (₹)',
      'Rate & Money',
      'NUMBER',
      `CASE WHEN ${BILLABLE_STATUS_SQL} THEN rt.bill_amount END`,
      {
        money: true,
        defaultVisible: true,
      },
    ),
    col(
      'billLineAmount',
      'Bill Line Total (₹)',
      'Rate & Money',
      'NUMBER',
      `CASE WHEN ${BILLABLE_STATUS_SQL} THEN (rt.bill_amount * ct.bill_count) END`,
      { money: true },
    ),
    col(
      'commissionAmount',
      'Commission (₹)',
      'Rate & Money',
      'NUMBER',
      `CASE WHEN ${COMMISSIONABLE_STATUS_SQL} THEN COALESCE(ct.commission_amount, com.commission_amount)::float8 END`,
      { money: true, defaultVisible: true },
    ),
    // TAT (per-task)
    col('tatHours', 'Target TAT (hrs)', 'TAT', 'NUMBER', 'ct.tat_hours'),
    col('submittedElapsedMinutes', 'Submit Elapsed (min)', 'TAT', 'NUMBER', 'ct.submitted_elapsed_minutes'),
    col('completedElapsedMinutes', 'Complete Elapsed (min)', 'TAT', 'NUMBER', 'ct.completed_elapsed_minutes'),
    // Field report (task-level narrative; 1:1 via field_reports)
    col('fieldReportNarrative', 'Field Report', 'Field Report', 'TEXT', 'fr.narrative', {
      defaultVisible: true,
    }),
    col('verificationType', 'Verification Type', 'Field Report', 'TEXT', 'fr.verification_type'),
    col('agentFieldNote', 'Agent Field Note', 'Field Report', 'TEXT', 'fr.outcome', { defaultVisible: true }),
    col('reportSnapshotAt', 'Report Snapshot At', 'Field Report', 'DATE', 'fr.rendered_at'),
    col('layoutName', 'Report Layout', 'Field Report', 'TEXT', 'fr.layout_name'),
    // Assignment (1:1)
    col('assigneeName', 'Assignee', 'Assignment', 'TEXT', 'au.name', {
      filterable: true,
      defaultVisible: true,
    }),
    col('assignedAt', 'Assigned At', 'Assignment', 'DATE', 'ct.assigned_at', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('submittedAt', 'Submitted At', 'Assignment', 'DATE', 'ct.submitted_at', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('completedAt', 'Completed At', 'Assignment', 'DATE', 'ct.completed_at', {
      sortable: true,
      filterable: true,
    }),
  ],
};

/**
 * CASE_OPERATIONAL — one row per case (bank-facing "one line per case"). Case scalars are 1:1; the
 * rollups (task/outcome counts, photo count, TAT days) and the money totals are CORRELATED SUBQUERIES
 * over the case's tasks — so nothing fans out and counting rows counts cases. Money totals reuse the
 * billing laterals inside the subquery (money-gated: dropped without billing.view).
 * FROM aliases: cs=cases, cl=clients, p=products, pa=case_applicants(primary), cb=users(completed_by).
 */
const CASE_OPERATIONAL: MisReportType = {
  type: 'CASE_OPERATIONAL',
  label: 'Operational Case MIS (one row per case)',
  grain: 'case',
  defaultSort: 'caseCreatedAt',
  columns: [
    col('caseNumber', 'Case Number', 'Case', 'TEXT', 'cs.case_number', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('clientName', 'Client', 'Case', 'TEXT', 'cl.name', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('productName', 'Product', 'Case', 'TEXT', 'p.name', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('caseStatus', 'Case Status', 'Case', 'SELECT', 'cs.status', {
      filterable: true,
      defaultVisible: true,
    }),
    col('caseVerdict', 'Case Verdict', 'Case', 'SELECT', 'cs.verification_outcome', {
      filterable: true,
      defaultVisible: true,
    }),
    col('caseResultRemark', 'Case Result Remark', 'Case', 'TEXT', 'cs.result_remark'),
    col('backendContactNumber', 'Office Contact', 'Case', 'TEXT', 'cs.backend_contact_number'),
    col('caseCreatedAt', 'Case Created', 'Case', 'DATE', 'cs.created_at', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('caseCompletedAt', 'Case Completed', 'Case', 'DATE', 'cs.completed_at', {
      sortable: true,
      filterable: true,
      defaultVisible: true,
    }),
    col('completedByName', 'Completed By', 'Case', 'TEXT', 'cb.name'),
    // Primary applicant (1:1)
    col('primaryName', 'Applicant', 'Applicant', 'TEXT', 'pa.name', {
      filterable: true,
      defaultVisible: true,
    }),
    col('primaryMobile', 'Mobile', 'Applicant', 'TEXT', 'pa.mobile', { filterable: true }),
    col('primaryPan', 'PAN', 'Applicant', 'TEXT', 'pa.pan', { filterable: true }),
    col('applicantType', 'Applicant Type', 'Applicant', 'SELECT', 'pa.applicant_type', { filterable: true }),
    // Rollups (correlated subqueries over the case's tasks)
    col(
      'totalTasks',
      'Total Tasks',
      'Rollup',
      'NUMBER',
      '(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id)',
      { defaultVisible: true },
    ),
    col(
      'completedTasks',
      'Completed Tasks',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id AND x.status = 'COMPLETED')",
      { defaultVisible: true },
    ),
    col(
      'positiveTasks',
      'Positive Tasks',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id AND x.verification_outcome = 'POSITIVE')",
    ),
    col(
      'negativeTasks',
      'Negative Tasks',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id AND x.verification_outcome = 'NEGATIVE')",
    ),
    col(
      'referTasks',
      'Refer Tasks',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id AND x.verification_outcome = 'REFER')",
    ),
    col(
      'fraudTasks',
      'Fraud Tasks',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_tasks x WHERE x.case_id = cs.id AND x.verification_outcome = 'FRAUD')",
    ),
    col(
      'photoCount',
      'Field Photos',
      'Rollup',
      'NUMBER',
      "(SELECT count(*)::int FROM case_attachments a WHERE a.case_id = cs.id AND a.kind = 'FIELD_PHOTO')",
    ),
    col(
      'caseTatDays',
      'Turnaround Days',
      'Rollup',
      'NUMBER',
      'CASE WHEN cs.completed_at IS NULL THEN NULL ELSE round(extract(epoch FROM (cs.completed_at - cs.created_at)) / 86400.0)::int END',
    ),
    // Money totals (billing.view-gated subqueries)
    col(
      'caseBillTotal',
      'Bill Total (₹)',
      'Rate & Money',
      'NUMBER',
      `(SELECT COALESCE(SUM(rt.bill_amount * ct.bill_count), 0)::float8 FROM case_tasks ct ${RATE_LATERAL} WHERE ct.case_id = cs.id AND ${BILLABLE_STATUS_SQL})`,
      { money: true, defaultVisible: true },
    ),
    col(
      'caseCommissionTotal',
      'Commission Total (₹)',
      'Rate & Money',
      'NUMBER',
      `(SELECT COALESCE(SUM(COALESCE(ct.commission_amount, com.commission_amount) * ct.bill_count), 0)::float8 FROM case_tasks ct ${COMMISSION_LATERAL} WHERE ct.case_id = cs.id AND ${COMMISSIONABLE_STATUS_SQL})`,
      { money: true, defaultVisible: true },
    ),
  ],
};

export const MIS_REPORT_TYPES: readonly MisReportType[] = [TASK_OPERATIONAL, CASE_OPERATIONAL];

export function getReportType(type: string): MisReportType | undefined {
  return MIS_REPORT_TYPES.find((rt) => rt.type === type);
}
