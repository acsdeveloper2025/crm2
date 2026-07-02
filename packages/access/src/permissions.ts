/**
 * @crm2/access — frozen RBAC model (mirrors the v1 seed by contract, not by import).
 * 6 roles; FIELD_AGENT has no page.* (mobile only, not on web).
 */
export const ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'TEAM_LEADER',
  'BACKEND_USER',
  'FIELD_AGENT',
  'KYC_VERIFIER',
] as const;
export type Role = (typeof ROLES)[number];

/** Permission codes used in v2 (extends as modules land). */
export const PERMISSIONS = {
  // master data
  VERIFICATION_UNIT_MANAGE: 'verification_unit.manage',
  MASTERDATA_MANAGE: 'masterdata.manage',
  MASTERDATA_VIEW: 'page.masterdata',
  // user administration
  USER_VIEW: 'page.users',
  USER_MANAGE: 'user.manage',
  ACCESS_VIEW: 'page.access',
  SYSTEM_VIEW: 'page.system',
  POLICY_VIEW: 'page.policies',
  POLICY_MANAGE: 'policy.manage',
  // cases / tasks
  CASE_VIEW: 'case.view',
  CASE_CREATE: 'case.create',
  CASE_ASSIGN: 'case.assign',
  // record the ONE final case verdict + close the case (ADR-0032 two-track model). BACKEND_USER/SA
  // + MANAGER/TEAM_LEADER (ADR-0050, owner 2026-06-20: supervisors may also close desk work).
  CASE_FINALIZE: 'case.finalize',
  // field-execution: the field agent drives their OWN assigned task on the device (start/submit/
  // complete/revoke/priority via /api/v2/verification-tasks). FIELD_AGENT only (+ SA grants_all);
  // the endpoint additionally binds assigned_to = actor (ADR-0032 slice 2c).
  TASK_EXECUTE: 'task.execute',
  // backend/office revoke of a LIVE task (ADR-0033, v1 parity): {ASSIGNED,IN_PROGRESS}→REVOKED with a
  // reason; a COMPLETED task CANNOT be revoked (use revisit). BACKEND_USER + MANAGER (+ SA grants_all).
  // The device revoke (own assigned task) stays on task.execute; this is the same DB transition,
  // scope-bound instead of ownership-bound.
  TASK_REVOKE: 'task.revoke',
  // office task intervention (ADR-0033, ADR-0032 slice 3): REVISIT a COMPLETED task (a new
  // lineage-linked task that re-opens the case, billed separately) OR REASSIGN-AFTER-REVOKE a
  // REVOKED task (a replacement task, no extra bill). BACKEND_USER + MANAGER (+ SA grants_all).
  TASK_REWORK: 'task.rework',
  // read-only cross-case duplicate lookup (standalone Dedupe Check page). Deliberately SEPARATE
  // from case.view: dedupe-search scans ALL cases regardless of the actor's case scope.
  DEDUPE_VIEW: 'dedupe.view',
  // close (complete) a desk/field task — record the report and finish it (ADR-0032 backend track).
  // BACKEND_USER/SA + MANAGER/TEAM_LEADER (ADR-0050, owner 2026-06-20). NOT the office relay
  // role (KYC_VERIFIER), whose job is the external email loop only — it never completes.
  FIELD_REVIEW_COMPLETE: 'field_review.complete',
  // field operations console (ADR-0026) — supervisors watch the field executives in their
  // hierarchy scope (roster + throughput + last-seen). SA/MANAGER/TEAM_LEADER.
  FIELD_MONITORING_VIEW: 'page.field_monitoring',
  // dashboard (ADR-0029) — read-only operations overview (pipeline counter + throughput + aging),
  // scoped to the actor's hierarchy. Every web role except FIELD_AGENT (mobile-only).
  DASHBOARD_VIEW: 'page.dashboard',
  // device location ingest (ADR-0026) — the field app's capture perm (mirrors how
  // /sync/download gates on a field-held perm). FIELD_AGENT only (+ SA grants_all).
  LOCATION_CAPTURE: 'location.capture',
  // data scope (Epic F) — assign a user's ACCESS SCOPE (field territory + backend portfolio).
  // SUPER_ADMIN only: only an admin sets who can see what; managers/TLs merely VIEW their subtree.
  ACCESS_SCOPE_ASSIGN: 'access_scope.assign',
  // role administration (ADR-0022) — edit a role's permission set / role config. SUPER_ADMIN only
  // (covered by grants_all; granting it to another role is itself a role.manage operation).
  ROLE_MANAGE: 'role.manage',
  // billing
  BILLING_GENERATE: 'billing.generate',
  // billing & commission view (ADR-0036, slice 5b) — the per-case Billing & Commission read-model
  // (bill + agent-commission amounts per completed task). Billing operators (office/finance), NOT
  // the broad masterdata viewers. The commission-rate CONFIG list stays masterdata.manage (SA-only).
  BILLING_VIEW: 'billing.view',
  // Dedicated per-role toggle for the periodic Commission Summary page + export (ADR-0081). Grantable
  // INDEPENDENTLY of billing.view (the per-case Billing page) so a payroll/finance role can hold one
  // without the other. Defaults to the same roles as billing.view (no access regression).
  BILLING_COMMISSION_SUMMARY_VIEW: 'billing.commission_summary.view',
  // platform capabilities — DataGrid export (IMPORT_EXPORT_STANDARD §1; default-deny, granted to web roles)
  DATA_EXPORT: 'data.export',
  // reporting — MIS (ADR-0084): the rebuilt MIS page + report-type catalog + rows (mis.view) and its
  // export (mis.export). Money columns inside MIS stay separately gated by billing.view; bulk PII export
  // is owner-accepted (registry §MIS-2026-07-01). Operational web roles; SUPER_ADMIN via grants_all.
  MIS_VIEW: 'mis.view',
  MIS_EXPORT: 'mis.export',
  // KYC-verifier export workflow (ADR-0085): the /kyc-queue page + self-scoped OFFICE-task list
  // (kyc_tasks.view) and its export/re-export action (kyc_tasks.export). Deliberately NOT
  // data.export — that would open every bulk export endpoint. KYC_VERIFIER (+ SA grants_all).
  KYC_TASKS_VIEW: 'kyc_tasks.view',
  KYC_TASKS_EXPORT: 'kyc_tasks.export',
  // Web-layer gate for the Pipeline + Cases LIST pages (ADR-0085, owner 2026-07-02): splits "can
  // read case data" (case.view — unchanged, still gates the APIs + case detail) from "sees the ops
  // list surfaces". KYC_VERIFIER's nav collapses to Dashboard + KYC verification; FIELD_AGENT
  // (mobile-first) loses the incidental web lists too. /api/v2 gates untouched (additive-only).
  PAGE_OPERATIONS: 'page.operations',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * RETIRED AT RUNTIME (ADR-0022): the live mapping is the `role_permissions` table; this constant
 * remains ONLY as the day-0 parity reference asserted by the roles seed parity test. Do not add
 * runtime readers.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  MANAGER: [
    PERMISSIONS.MASTERDATA_VIEW,
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_ASSIGN,
    // ADR-0050: MANAGER + TEAM_LEADER may also close/finalize desk work (owner 2026-06-20).
    PERMISSIONS.FIELD_REVIEW_COMPLETE,
    PERMISSIONS.CASE_FINALIZE,
    PERMISSIONS.TASK_REVOKE,
    PERMISSIONS.TASK_REWORK,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_MONITORING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_GENERATE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW,
    PERMISSIONS.DATA_EXPORT,
    PERMISSIONS.MIS_VIEW,
    PERMISSIONS.MIS_EXPORT,
    PERMISSIONS.PAGE_OPERATIONS,
  ],
  TEAM_LEADER: [
    PERMISSIONS.MASTERDATA_VIEW,
    PERMISSIONS.CASE_VIEW,
    // ADR-0065: BACKEND_USER + TEAM_LEADER may open cases for their scope (owner 2026-06-25).
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_ASSIGN,
    // ADR-0050: MANAGER + TEAM_LEADER may also close/finalize desk work (owner 2026-06-20).
    PERMISSIONS.FIELD_REVIEW_COMPLETE,
    PERMISSIONS.CASE_FINALIZE,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_MONITORING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DATA_EXPORT,
    PERMISSIONS.MIS_VIEW,
    PERMISSIONS.MIS_EXPORT,
    PERMISSIONS.PAGE_OPERATIONS,
  ],
  BACKEND_USER: [
    PERMISSIONS.MASTERDATA_VIEW,
    PERMISSIONS.CASE_VIEW,
    // ADR-0065: BACKEND_USER opens cases/tasks for its assigned client+product portfolio (owner 2026-06-25).
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_REVIEW_COMPLETE,
    PERMISSIONS.CASE_FINALIZE,
    PERMISSIONS.TASK_REVOKE,
    PERMISSIONS.TASK_REWORK,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_COMMISSION_SUMMARY_VIEW,
    PERMISSIONS.DATA_EXPORT,
    PERMISSIONS.MIS_VIEW,
    PERMISSIONS.MIS_EXPORT,
    PERMISSIONS.PAGE_OPERATIONS,
  ],
  FIELD_AGENT: [PERMISSIONS.CASE_VIEW, PERMISSIONS.LOCATION_CAPTURE, PERMISSIONS.TASK_EXECUTE],
  // ADR-0085 (owner 2026-07-02): the read-only KYC verifier NEVER opens case/task detail — NO
  // case.view (mig 0111). His whole surface is the KYC queue (see + export HIS assigned OFFICE tasks)
  // + his own tasks' reference attachments (kyc_tasks.view-gated). Still no complete/close.
  KYC_VERIFIER: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.KYC_TASKS_VIEW, PERMISSIONS.KYC_TASKS_EXPORT],
};

/** Human-readable label + grouping for each permission (Access Control / Roles admin views). */
export const PERMISSION_META: Record<Permission, { label: string; group: string }> = {
  'page.masterdata': { label: 'Master Data — View', group: 'Administration' },
  'verification_unit.manage': { label: 'Verification Units — Manage', group: 'Administration' },
  'masterdata.manage': { label: 'Master Data — Manage', group: 'Administration' },
  'page.users': { label: 'User Management — View', group: 'Administration' },
  'user.manage': { label: 'User Management — Manage', group: 'Administration' },
  'page.access': { label: 'Access Control — View', group: 'Administration' },
  'page.system': { label: 'System Health — View', group: 'Administration' },
  'page.policies': { label: 'Policies — View', group: 'Administration' },
  'policy.manage': { label: 'Policies — Manage', group: 'Administration' },
  'case.view': { label: 'Cases — View', group: 'Operations' },
  'case.create': { label: 'Cases — Create', group: 'Operations' },
  'case.assign': { label: 'Cases — Assign', group: 'Operations' },
  'case.finalize': { label: 'Cases — Finalize (record verdict)', group: 'Operations' },
  'task.execute': { label: 'Task — Execute (field app)', group: 'Operations' },
  'task.revoke': { label: 'Task — Revoke', group: 'Operations' },
  'task.rework': { label: 'Task — Revisit / Reassign', group: 'Operations' },
  'dedupe.view': { label: 'Dedupe — Check', group: 'Operations' },
  'field_review.complete': { label: 'Field Review — Complete', group: 'Operations' },
  'page.field_monitoring': { label: 'Field Monitoring — View', group: 'Operations' },
  'page.dashboard': { label: 'Dashboard — View', group: 'Operations' },
  'location.capture': { label: 'Location — Capture (field app)', group: 'Operations' },
  'access_scope.assign': { label: 'Access Scope — Assign (territory + portfolio)', group: 'Administration' },
  'role.manage': { label: 'Roles — Manage (permission sets)', group: 'Administration' },
  'billing.generate': { label: 'Billing — Generate', group: 'Billing' },
  'billing.view': { label: 'Billing & Commission — View', group: 'Billing' },
  'billing.commission_summary.view': { label: 'Commission Summary — View', group: 'Billing' },
  'data.export': { label: 'Data Export', group: 'Platform' },
  'mis.view': { label: 'MIS — View', group: 'Reports' },
  'mis.export': { label: 'MIS — Export', group: 'Reports' },
  'kyc_tasks.view': { label: 'KYC Queue — View', group: 'Operations' },
  'kyc_tasks.export': { label: 'KYC Queue — Export', group: 'Operations' },
  'page.operations': { label: 'Operations Lists — View (Pipeline / Cases)', group: 'Operations' },
};
