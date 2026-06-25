/**
 * @crm2/sdk — the System Health contract (read-only). Admin diagnostics: API/DB status,
 * DB round-trip latency, authoritative server time, and record counts of the master-data
 * tables. No write contract.
 */
export interface SystemHealthCounts {
  clients: number;
  products: number;
  verificationUnits: number;
  users: number;
  rates: number;
  locations: number;
}

/** FCM push health (ADR-0027): is a service account provisioned, did the SDK init, how many live tokens. */
export interface PushHealth {
  configured: boolean;
  initialized: boolean;
  activeTokens: number;
}

export interface SystemHealth {
  status: 'ok' | 'degraded';
  environment: string;
  /** DB-authoritative time (ISO); empty if the DB is unreachable. */
  serverTime: string;
  database: { connected: boolean; latencyMs: number | null };
  push: PushHealth;
  counts: SystemHealthCounts;
}
