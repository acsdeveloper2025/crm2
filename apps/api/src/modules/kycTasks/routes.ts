import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { kycTasksController as c } from './controller.js';

/**
 * KYC-verifier queue routes (ADR-0085). `kyc_tasks.view` gates the list (KYC_VERIFIER + SA
 * grants-all); the export/re-export endpoint (`kyc_tasks.export`) lands in slice 3. The rows are
 * additionally scope-composed — the perm alone never widens visibility.
 */
export const kycTaskRoutes: Router = Router();

kycTaskRoutes.get('/', authorize(PERMISSIONS.KYC_TASKS_VIEW), c.list);
// The claim action: first export writes the first-export events (dedup at the DB), re-export
// (`?reexportReason=`) appends reasoned events. GET streams the file (DataGrid export transport).
kycTaskRoutes.get('/export', authorize(PERMISSIONS.KYC_TASKS_EXPORT), c.export);
// The verifier's OWN-task reference attachments (ADR-0085) — his only attachment path now that he
// has no case.view / case page. Row-scoped in the repository (a foreign task → [] / 404).
kycTaskRoutes.get('/:taskId/attachments', authorize(PERMISSIONS.KYC_TASKS_VIEW), c.listAttachments);
kycTaskRoutes.get(
  '/:taskId/attachments/:attachmentId/url',
  authorize(PERMISSIONS.KYC_TASKS_VIEW),
  c.attachmentUrl,
);
