/**
 * @crm2/sdk — Field Monitoring console (ADR-0026). One row per field executive in the
 * supervisor's hierarchy scope: workload + today's throughput + aging + last-seen. All
 * fields are real (case_tasks / users / territory); the GPS `last*` fields stay null until
 * the device rebases onto /api/v2 (forward-prep). NO fabricated presence column.
 */
export interface FieldAgentView {
  id: string;
  name: string;
  username: string;
  employeeId: string | null;
  phone: string | null;
  isActive: boolean;
  /** open = assigned & not yet completed (PENDING/ASSIGNED/IN_PROGRESS/SUBMITTED). */
  openTasks: number;
  inProgress: number;
  /** tasks this agent completed since local start-of-day. */
  completedToday: number;
  /** open tasks assigned more than the overdue window ago (aging). */
  overdue: number;
  /** oldest still-open assignment (for the aging read); null when no open work. */
  oldestOpenAssignedAt: string | null;
  /** max over the agent's tasks of assigned/completed/updated — the truthful "last activity". */
  lastActivityAt: string | null;
  territoryPincodes: number;
  territoryAreas: number;
  /** last-known GPS (latest_device_location) — null until the device rebases. */
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: string | null;
  lastLocationSource: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Scope+search-aware counter bar for the console header. */
export interface FieldMonitoringStats {
  agents: number;
  withOpenWork: number;
  openTasks: number;
  completedToday: number;
  overdue: number;
}
