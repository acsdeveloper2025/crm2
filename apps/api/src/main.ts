import { createServer } from 'node:http';
import { loadEnv } from '@crm2/config';
import { logger } from '@crm2/logger';
import { createApp } from './http/app.js';
import { registerJobs } from './http/registerJobs.js';
import { initRealtime } from './platform/realtime/index.js';
import { startJobWorker } from './platform/jobs/index.js';
import { startReverseGeocodeWorker } from './platform/geocode/queue.js';
import { warmUpPush } from './platform/push/index.js';

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
