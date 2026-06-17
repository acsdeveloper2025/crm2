import type { SystemHealthCounts } from '@crm2/sdk';
import { query } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';

const NS_PER_MS = 1e6;

interface HealthRow extends SystemHealthCounts {
  serverTime: string;
  activeTokens: number;
}

export const systemRepository = {
  /** One round-trip: master-data counts + DB-authoritative time, with measured latency. */
  async health(): Promise<{
    latencyMs: number;
    serverTime: string;
    counts: SystemHealthCounts;
    activeTokens: number;
  }> {
    const start = process.hrtime.bigint();
    const rows = await query<HealthRow>(
      `SELECT
         (SELECT count(*) FROM clients)::int            AS clients,
         (SELECT count(*) FROM products)::int           AS products,
         (SELECT count(*) FROM verification_units)::int AS verification_units,
         (SELECT count(*) FROM users)::int              AS users,
         (SELECT count(*) FROM report_templates)::int   AS report_templates,
         (SELECT count(*) FROM rates)::int              AS rates,
         (SELECT count(*) FROM locations)::int          AS locations,
         (SELECT count(*) FROM notification_tokens WHERE is_active)::int AS active_tokens,
         now() AS server_time`,
    );
    const latencyMs = Number(process.hrtime.bigint() - start) / NS_PER_MS;
    const row = rows[0];
    if (!row) throw AppError.internal('health query returned no row');
    const { serverTime, activeTokens, ...counts } = row;
    return { latencyMs, serverTime, counts, activeTokens };
  },
};
