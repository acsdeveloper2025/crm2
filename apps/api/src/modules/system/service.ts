import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import type { SystemHealth, SystemHealthCounts, PushHealth } from '@crm2/sdk';
import { systemRepository as repo } from './repository.js';
import { pushConfigured, getPusher } from '../../platform/push/index.js';

const MS_ROUNDING = 100; // 2-decimal ms
const ZERO_COUNTS: SystemHealthCounts = {
  clients: 0,
  products: 0,
  verificationUnits: 0,
  users: 0,
  reportTemplates: 0,
  rates: 0,
  locations: 0,
};

/** NODE_ENV for the health payload — resolved without ever throwing (a health probe must not 500). */
function resolveEnvironment(): string {
  try {
    return loadEnv().NODE_ENV;
  } catch {
    return process.env['NODE_ENV'] ?? 'development';
  }
}

/**
 * System service — read-only diagnostics. A health endpoint must REPORT a DB outage,
 * not 500 on it, so a failed probe degrades gracefully (status 'degraded', connected false).
 */
export const systemService = {
  async health(): Promise<SystemHealth> {
    const environment = resolveEnvironment();
    // FCM probe (ADR-0027): pure accessors, never trigger init (a probe must have no side effects).
    const pushBase: Pick<PushHealth, 'configured' | 'initialized'> = {
      configured: pushConfigured(),
      initialized: getPusher().ready(),
    };
    try {
      const { latencyMs, serverTime, counts, activeTokens } = await repo.health();
      return {
        status: 'ok',
        environment,
        serverTime,
        database: { connected: true, latencyMs: Math.round(latencyMs * MS_ROUNDING) / MS_ROUNDING },
        push: { ...pushBase, activeTokens },
        counts,
      };
    } catch (e) {
      logger.error('system health probe failed', { err: e instanceof Error ? e.message : String(e) });
      return {
        status: 'degraded',
        environment,
        serverTime: '',
        database: { connected: false, latencyMs: null },
        push: { ...pushBase, activeTokens: 0 },
        counts: ZERO_COUNTS,
      };
    }
  },
};
