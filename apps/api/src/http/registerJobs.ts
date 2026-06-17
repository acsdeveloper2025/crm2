import { logger } from '@crm2/logger';
import { registerJobProcessor, setJobNotifier } from '../platform/jobs/index.js';
import { exportJobProcessor, registerExportBuilder, buildExportFile } from '../platform/export/job.js';
import { importJobProcessor, registerImportRunner } from '../platform/import/index.js';
import { registerReverseGeocodeProcessor, setReverseGeocodeDeadLetter } from '../platform/geocode/queue.js';
import { locationService } from '../modules/locations/service.js';
import { notificationService } from '../modules/notifications/service.js';
import { caseService } from '../modules/cases/service.js';
import { geocodeRepository } from '../modules/geocode/repository.js';
import { caseReportJobProcessor } from '../modules/caseReports/job.js';

/**
 * Boot wiring (ADR-0030): register the job processors + each resource's async export builder. Lives at
 * the http/boot layer (not platform) so the job engine never imports a feature module — mirroring how
 * setJobNotifier injects the notifications producer. Called by createApp and (later) the worker boot.
 * Idempotent: registrations overwrite, so repeated calls (per-test createApp) are safe.
 */
export function registerJobs(): void {
  // A finished job lands in the bell (+ socket/toast). Injected here so the engine (platform) stays
  // free of module deps; wired for BOTH the api (createApp) and the worker (main.ts) boot.
  setJobNotifier((n) => {
    void notificationService.notify(n).catch((e) => {
      logger.warn('job notify failed', { error: e instanceof Error ? e.message : String(e) });
    });
  });

  registerJobProcessor('EXPORT', exportJobProcessor);
  registerJobProcessor('IMPORT', importJobProcessor);
  // CASE_REPORT (ADR-0041 S5 slice 2b): render the case report to PDF + store it for presigned download.
  registerJobProcessor('CASE_REPORT', caseReportJobProcessor);

  // locations (157k catalog) — the first async export+import resource; others adopt incrementally.
  registerExportBuilder('locations', (query, _actorId, cols, format) =>
    locationService.exportAllForJob(query).then(async ({ rows, columns, totalCount }) => ({
      ...(await buildExportFile(rows, columns, cols, 'locations', format)),
      totalCount,
    })),
  );
  registerImportRunner('locations', (buffer, ctx) =>
    locationService.importConfirm(buffer, ctx.userId, ctx.fileName),
  );

  // Reverse-geocode (ADR-0040 S4 Slice B): the resolve+persist processor + the DLQ dead-letter, wired
  // here so the platform queue never imports a module (mirrors the job processors above).
  registerReverseGeocodeProcessor((job) => caseService.reverseGeocodeFieldPhotoJob(job));
  setReverseGeocodeDeadLetter((job, error) =>
    geocodeRepository.insertReverseGeocodeDlq(job.attachmentId, job.lat, job.lng, error),
  );
}
