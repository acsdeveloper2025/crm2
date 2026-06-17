import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '@crm2/logger';
import { AppError } from '../platform/errors.js';
import { HTTP_STATUS } from '../platform/http.js';
import { testAuth } from './testAuth.js';
import { authenticate } from './authenticate.js';
import { enrichAuth } from './enrichAuth.js';
import { authRoutes } from '../modules/auth/routes.js';
import { caseRoutes } from '../modules/cases/routes.js';
import { taskRoutes } from '../modules/tasks/routes.js';
import { verificationTaskRoutes } from '../modules/verification-tasks/routes.js';
import { fieldMonitoringRoutes } from '../modules/field-monitoring/routes.js';
import { dashboardRoutes } from '../modules/dashboard/routes.js';
import { notificationRoutes } from '../modules/notifications/routes.js';
import { jobRoutes } from '../modules/jobs/routes.js';
import { savedViewRoutes } from '../modules/saved-views/routes.js';
import { registerJobs } from './registerJobs.js';
import { locationCaptureRoutes } from '../modules/location/routes.js';
import { geocodeRoutes } from '../modules/geocode/routes.js';
import { syncRoutes } from '../modules/sync/routes.js';
import { verificationUnitRoutes } from '../modules/verificationUnits/routes.js';
import { clientRoutes } from '../modules/clients/routes.js';
import { productRoutes } from '../modules/products/routes.js';
import { clientProductRoutes, cpvUnitRoutes } from '../modules/cpv/routes.js';
import { rateRoutes } from '../modules/rates/routes.js';
import { rateTypeRoutes } from '../modules/rateTypes/routes.js';
import { commissionRateRoutes } from '../modules/commissionRates/routes.js';
import { billingRoutes } from '../modules/billing/routes.js';
import { locationRoutes } from '../modules/locations/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import { accessRoutes } from '../modules/access/routes.js';
import { roleRoutes } from '../modules/roles/routes.js';
import { reportTemplateRoutes } from '../modules/reportTemplates/routes.js';
import { reportLayoutRoutes } from '../modules/reportLayouts/routes.js';
import { caseDataEntryRoutes } from '../modules/caseDataEntries/routes.js';
import { departmentRoutes } from '../modules/departments/routes.js';
import { designationRoutes } from '../modules/designations/routes.js';
import { systemRoutes } from '../modules/system/routes.js';
import { timeRoutes } from '../modules/time/routes.js';

const NS_PER_MS = 1e6;
const MS_ROUNDING = 100; // 2-decimal ms

/** Observability (Part 36): every API request logs requestId, duration, status, userId. */
function requestObservability() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.header('x-request-id') ?? randomUUID();
    const start = process.hrtime.bigint();
    const log = logger.child({ requestId });
    req.log = log;
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / NS_PER_MS;
      log.info('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * MS_ROUNDING) / MS_ROUNDING,
        userId: req.auth?.userId ?? null,
      });
    });
    next();
  };
}

export function createApp(opts: { enableTestAuth?: boolean } = {}): Express {
  // ADR-0030: wire the job notifier (bell) + EXPORT processor + per-resource export builders. Shared
  // with the ROLE=worker boot so both run the same registrations.
  registerJobs();

  const app = express();
  app.use(express.json());
  if (opts.enableTestAuth ?? process.env['NODE_ENV'] !== 'production') app.use(testAuth());
  app.use(authenticate()); // real Bearer auth wins over the dev seam when a valid token is present
  app.use(enrichAuth()); // ADR-0022: resolve role attributes (grants_all + permission codes, cached)
  app.use(requestObservability());

  app.get('/api/v2/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/v2/time', timeRoutes); // ADR-0028: server-authoritative clock (unauthenticated)
  app.use('/api/v2/auth', authRoutes);
  app.use('/api/v2/verification-units', verificationUnitRoutes);
  app.use('/api/v2/clients', clientRoutes);
  app.use('/api/v2/products', productRoutes);
  app.use('/api/v2/client-products', clientProductRoutes);
  app.use('/api/v2/cpv-units', cpvUnitRoutes);
  app.use('/api/v2/rates', rateRoutes);
  app.use('/api/v2/rate-types', rateTypeRoutes);
  app.use('/api/v2/commission-rates', commissionRateRoutes);
  app.use('/api/v2/billing', billingRoutes);
  app.use('/api/v2/locations', locationRoutes);
  app.use('/api/v2/users', userRoutes);
  app.use('/api/v2/access', accessRoutes);
  app.use('/api/v2/roles', roleRoutes);
  app.use('/api/v2/report-templates', reportTemplateRoutes);
  app.use('/api/v2/report-layouts', reportLayoutRoutes);
  app.use('/api/v2/data-entry', caseDataEntryRoutes);
  app.use('/api/v2/departments', departmentRoutes);
  app.use('/api/v2/designations', designationRoutes);
  app.use('/api/v2/system', systemRoutes);
  app.use('/api/v2/cases', caseRoutes);
  app.use('/api/v2/sync', syncRoutes);
  app.use('/api/v2/tasks', taskRoutes);
  app.use('/api/v2/verification-tasks', verificationTaskRoutes); // field-execution (ADR-0032 slice 2c)
  app.use('/api/v2/field-monitoring', fieldMonitoringRoutes);
  app.use('/api/v2/dashboard', dashboardRoutes);
  app.use('/api/v2/notifications', notificationRoutes);
  app.use('/api/v2/jobs', jobRoutes);
  app.use('/api/v2/saved-views', savedViewRoutes);
  app.use('/api/v2/location', locationCaptureRoutes);
  app.use('/api/v2/geocode', geocodeRoutes);

  // Centralized error → HTTP mapping (last middleware).
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'VALIDATION', issues: err.issues });
    }
    if (err instanceof AppError) {
      const body: Record<string, unknown> = { error: err.code, details: err.details };
      // OCC: surface the fresh row at top level on a conflict (ADR-0019: { error:'STALE_UPDATE', current }).
      if (err.code === 'STALE_UPDATE' && err.details && typeof err.details === 'object') {
        Object.assign(body, err.details);
      }
      return res.status(err.status).json(body);
    }
    const status = (err as { status?: number }).status;
    const code = (err as { code?: string }).code;
    if (status && code) return res.status(status).json({ error: code });
    (req.log ?? logger).error('unhandled error', { err: err instanceof Error ? err.message : String(err) });
    return res.status(HTTP_STATUS.INTERNAL).json({ error: 'INTERNAL' });
  });

  return app;
}
