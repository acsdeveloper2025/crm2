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
  TEMPLATE_VIEW: 'page.templates',
  TEMPLATE_MANAGE: 'report_template.manage',
  SYSTEM_VIEW: 'page.system',
  // cases / tasks
  CASE_VIEW: 'case.view',
  CASE_CREATE: 'case.create',
  CASE_ASSIGN: 'case.assign',
  // record the ONE final case verdict + close the case (ADR-0032 two-track model). BACKEND_USER/SA.
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
  FIELD_REVIEW_COMPLETE: 'field_review.complete',
  // office data-entry (ADR-0037, MIS engine) — an office operator keys the structured MIS fields for
  // a task against its CPV's active DATA_ENTRY layout. Office roles (MANAGER + BACKEND_USER + SA).
  DATA_ENTRY_MANAGE: 'data_entry.manage',
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
  // platform capabilities — DataGrid export (IMPORT_EXPORT_STANDARD §1; default-deny, granted to web roles)
  DATA_EXPORT: 'data.export',
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
    PERMISSIONS.TASK_REVOKE,
    PERMISSIONS.TASK_REWORK,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_MONITORING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_GENERATE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.DATA_ENTRY_MANAGE,
    PERMISSIONS.DATA_EXPORT,
  ],
  TEAM_LEADER: [
    PERMISSIONS.MASTERDATA_VIEW,
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.CASE_ASSIGN,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_MONITORING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.DATA_EXPORT,
  ],
  BACKEND_USER: [
    PERMISSIONS.MASTERDATA_VIEW,
    PERMISSIONS.CASE_VIEW,
    PERMISSIONS.DEDUPE_VIEW,
    PERMISSIONS.FIELD_REVIEW_COMPLETE,
    PERMISSIONS.CASE_FINALIZE,
    PERMISSIONS.TASK_REVOKE,
    PERMISSIONS.TASK_REWORK,
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.DATA_ENTRY_MANAGE,
    PERMISSIONS.DATA_EXPORT,
  ],
  FIELD_AGENT: [PERMISSIONS.CASE_VIEW, PERMISSIONS.LOCATION_CAPTURE, PERMISSIONS.TASK_EXECUTE],
  KYC_VERIFIER: [PERMISSIONS.CASE_VIEW, PERMISSIONS.DASHBOARD_VIEW],
};

/** Human-readable label + grouping for each permission (Access Control / Roles admin views). */
export const PERMISSION_META: Record<Permission, { label: string; group: string }> = {
  'page.masterdata': { label: 'Master Data — View', group: 'Administration' },
  'verification_unit.manage': { label: 'Verification Units — Manage', group: 'Administration' },
  'masterdata.manage': { label: 'Master Data — Manage', group: 'Administration' },
  'page.users': { label: 'User Management — View', group: 'Administration' },
  'user.manage': { label: 'User Management — Manage', group: 'Administration' },
  'page.access': { label: 'Access Control — View', group: 'Administration' },
  'page.templates': { label: 'Report Templates — View', group: 'Administration' },
  'report_template.manage': { label: 'Report Templates — Manage', group: 'Administration' },
  'page.system': { label: 'System Health — View', group: 'Administration' },
  'case.view': { label: 'Cases — View', group: 'Operations' },
  'case.create': { label: 'Cases — Create', group: 'Operations' },
  'case.assign': { label: 'Cases — Assign', group: 'Operations' },
  'case.finalize': { label: 'Cases — Finalize (record verdict)', group: 'Operations' },
  'task.execute': { label: 'Task — Execute (field app)', group: 'Operations' },
  'task.revoke': { label: 'Task — Revoke', group: 'Operations' },
  'task.rework': { label: 'Task — Revisit / Reassign', group: 'Operations' },
  'dedupe.view': { label: 'Dedupe — Check', group: 'Operations' },
  'field_review.complete': { label: 'Field Review — Complete', group: 'Operations' },
  'data_entry.manage': { label: 'Data Entry — Manage', group: 'Operations' },
  'page.field_monitoring': { label: 'Field Monitoring — View', group: 'Operations' },
  'page.dashboard': { label: 'Dashboard — View', group: 'Operations' },
  'location.capture': { label: 'Location — Capture (field app)', group: 'Operations' },
  'access_scope.assign': { label: 'Access Scope — Assign (territory + portfolio)', group: 'Administration' },
  'role.manage': { label: 'Roles — Manage (permission sets)', group: 'Administration' },
  'billing.generate': { label: 'Billing — Generate', group: 'Billing' },
  'billing.view': { label: 'Billing & Commission — View', group: 'Billing' },
  'data.export': { label: 'Data Export', group: 'Platform' },
};
