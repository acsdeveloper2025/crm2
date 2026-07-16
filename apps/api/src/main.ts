import { createServer } from 'node:http';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import { createApp } from './http/app.js';
import { registerJobs } from './http/registerJobs.js';
import { initRealtime } from './platform/realtime/index.js';
import { startJobWorker } from './platform/jobs/index.js';
import { startReverseGeocodeWorker } from './platform/geocode/queue.js';
import { warmUpPush } from './platform/push/index.js';
import {
  ABANDON_SWEEP_FIRST_DELAY_MS,
  ABANDON_SWEEP_INTERVAL_MS,
  runAbandonSweep,
} from './platform/tat/abandonSweep.js';

/**
 * The abandonment sweep's tick (ADR-0095) — crm2's first periodic, unattended writer.
 *
 * WHY HERE, and not the obvious places:
 *  - NOT `registerJobs()`: `createApp` calls it too, so a timer there would fire in every test process
 *    and would double-fire the day the worker container is uncommented.
 *  - NOT the BullMQ jobs engine (ADR-0030): it is dead in prod (no worker container, no Valkey), and its
 *    `jobs` row requires `created_by NOT NULL REFERENCES users` — an unattended sweep has no user.
 *  - NOT node-cron / host crontab: a new dependency, or a trigger that lives outside the repo and outside
 *    code review. The prod box has no crontab today.
 * So: a plain timer in the one role that is guaranteed to be running.
 *
 * HOURLY, not daily. A deploy recreates the container (`docker-compose up -d`) and `restart:
 * unless-stopped` re-anchors the timer's phase, so a long interval on a frequently-deployed box could
 * never fire at all. Hourly bounds that loss to one tick against a 45-day window, which is why this
 * needs no watermark table.
 *
 * `unref()` so the timer never holds the process open during shutdown, and the first tick is delayed so
 * boot is not competing with a sweep for the pool.
 */
function startAbandonSweep(): void {
  const tick = (): void => {
    void runAbandonSweep().catch((err: unknown) => {
      // Never let a sweep failure take the API down — it retries next hour.
      logger.error('abandon-sweep tick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };
  setTimeout(tick, ABANDON_SWEEP_FIRST_DELAY_MS).unref();
  setInterval(tick, ABANDON_SWEEP_INTERVAL_MS).unref();
}

/** ROLE-gated bootstrap (api | worker | report). */
function main(): void {
  const env = loadEnv();

  if (env.ROLE === 'api') {
    const app = createApp();
    // socket.io shares the HTTP server (ADR-0027) so real-time + REST live on one port.
    const server = createServer(app);
    // Slowloris / stuck-request defense (ADR-0076): bound how long a request (incl. its headers)
    // may take. headersTimeout must exceed requestTimeout (Node http). Both sit at/under nginx's
    // 120s proxy_read_timeout so a stuck request fails cleanly at the origin, not the edge.
    server.requestTimeout = 120_000;
    server.headersTimeout = 125_000;
    initRealtime(server, env);
    void warmUpPush(env); // init the FCM SDK at boot when configured (ADR-0027); no-op otherwise
    startAbandonSweep(); // ADR-0095: auto-revoke tasks held past the abandonment window
    server.listen(env.PORT, () => {
      logger.info('api listening', { port: env.PORT, env: env.NODE_ENV });
    });
    return;
  }

  if (env.ROLE === 'worker') {
    // The out-of-process job tier (ADR-0030). It needs: the job processors + bell notifier
    // (registerJobs), and an emit-only realtime — a socket.io server on a non-listening HTTP server
    // engages the Valkey adapter (REDIS_CACHE_URL) so job:progress/job:done published here reach the
    // API's connected clients. Then it consumes the BullMQ queue.
    initRealtime(createServer(), env);
    registerJobs();
    void startJobWorker();
    void startReverseGeocodeWorker(); // ADR-0040 S4 Slice B — consumes the crm2-geocode queue
    logger.info('worker role started');
    return;
  }

  logger.warn('role not yet implemented (build step pending)', { role: env.ROLE });
}

main();
