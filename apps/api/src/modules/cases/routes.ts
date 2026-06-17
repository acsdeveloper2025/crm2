import { Router, raw } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { caseController as c } from './controller.js';
import { fieldReportController } from '../fieldReports/controller.js';
import { caseReportController } from '../caseReports/controller.js';

/**
 * /api/v2/cases — Zion NewDataEntry flow. Reads: case.view. Writes: case.create.
 * Static paths (/dedupe, /available-units) are declared before /:id.
 */
export const caseRoutes: Router = Router();

caseRoutes.post('/dedupe', authorize(PERMISSIONS.CASE_VIEW), c.dedupe);
// Standalone Dedupe Check page — dedicated read-only perm (NOT case.view; scans ALL cases).
// Static paths declared before /:id; the /export path before its bare sibling.
caseRoutes.get('/dedupe-search/export', authorize(PERMISSIONS.DATA_EXPORT), c.dedupeSearchExport);
caseRoutes.get('/dedupe-search', authorize(PERMISSIONS.DEDUPE_VIEW), c.dedupeSearch);
caseRoutes.get('/available-units', authorize(PERMISSIONS.CASE_CREATE), c.availableUnits);
caseRoutes.post('/', authorize(PERMISSIONS.CASE_CREATE), c.create);
caseRoutes.post('/:id/tasks', authorize(PERMISSIONS.CASE_CREATE), c.addTasks);
caseRoutes.post('/:id/tasks/:taskId/assign', authorize(PERMISSIONS.CASE_ASSIGN), c.assignTask);
caseRoutes.post('/:id/tasks/:taskId/unassign', authorize(PERMISSIONS.CASE_ASSIGN), c.unassignTask);
caseRoutes.post('/:id/tasks/:taskId/complete', authorize(PERMISSIONS.FIELD_REVIEW_COMPLETE), c.completeTask);
// Record the per-task office result on an already-COMPLETED (field-completed) task (ADR-0032 D3).
caseRoutes.post(
  '/:id/tasks/:taskId/result',
  authorize(PERMISSIONS.FIELD_REVIEW_COMPLETE),
  c.recordTaskResult,
);
// Case verdict history (ADR-0033): every finalize (who/when/what), newest first. case.view.
caseRoutes.get('/:id/verdict-history', authorize(PERMISSIONS.CASE_VIEW), c.verdictHistory);
// Backend/office REVOKE a LIVE task (ADR-0033, v1 parity): {ASSIGNED,IN_PROGRESS} → REVOKED.
// task.revoke (BACKEND_USER/MANAGER + SA). A COMPLETED task cannot be revoked (revisit it instead).
caseRoutes.post('/:id/tasks/:taskId/revoke', authorize(PERMISSIONS.TASK_REVOKE), c.revokeTask);
// Office task intervention (ADR-0033, slice 3): REVISIT a COMPLETED task (new lineage task, billed
// separately) or REASSIGN-AFTER-REVOKE a REVOKED task (replacement task). task.rework
// (BACKEND_USER/MANAGER + SA).
caseRoutes.post('/:id/tasks/:taskId/revisit', authorize(PERMISSIONS.TASK_REWORK), c.revisitTask);
caseRoutes.post('/:id/tasks/:taskId/reassign', authorize(PERMISSIONS.TASK_REWORK), c.reassignTask);
// Case finalize (ADR-0032): record the ONE final verdict + close. case.finalize (BACKEND_USER/SA).
caseRoutes.post('/:id/finalize', authorize(PERMISSIONS.CASE_FINALIZE), c.finalizeCase);
caseRoutes.get('/:id/assignable-users', authorize(PERMISSIONS.CASE_ASSIGN), c.assignableUsers);
caseRoutes.get('/:id/eligible-assignees', authorize(PERMISSIONS.CASE_ASSIGN), c.eligibleAssignees);
// Reference attachments (ADR-0025 B2): read = case.view (assignee incl. read-only KYC verifier);
// upload/delete = case.create (office). Upload body is raw bytes (octet-stream + x-filename), 25 MiB cap.
caseRoutes.get('/:id/attachments', authorize(PERMISSIONS.CASE_VIEW), c.listAttachments);
// Device field photos (ADR-0034) — read-only list for the case-detail Field Photos card.
caseRoutes.get('/:id/field-photos', authorize(PERMISSIONS.CASE_VIEW), c.listFieldPhotos);
// On-view reverse-geocode of one field photo (ADR-0040) — resolves + freezes the address.
caseRoutes.get(
  '/:id/field-photos/:attachmentId/address',
  authorize(PERMISSIONS.CASE_VIEW),
  c.fieldPhotoAddress,
);
// FIELD_REPORT narrative (ADR-0039) — the #6 card's rendered report for one task.
caseRoutes.get(
  '/:id/tasks/:taskId/field-report',
  authorize(PERMISSIONS.CASE_VIEW),
  fieldReportController.getFieldReport,
);
// CASE_REPORT preview JSON (ADR-0041, S5 slice 1) — the assembled CaseReportContext the renderers
// (slices 2/4/5) all run against; admin Designer uses it as the variable catalog.
caseRoutes.get('/:id/report/preview', authorize(PERMISSIONS.CASE_VIEW), caseReportController.preview);
// CASE_REPORT rendered HTML (ADR-0041 S5 slice 2a) — the same markup Puppeteer prints to PDF (2b).
caseRoutes.get('/:id/report.html', authorize(PERMISSIONS.CASE_VIEW), caseReportController.html);
// CASE_REPORT PDF — enqueue a background job (ADR-0041 S5 slice 2b); 202 + JobView, download via /jobs.
caseRoutes.post('/:id/report', authorize(PERMISSIONS.CASE_VIEW), caseReportController.enqueue);
caseRoutes.post(
  '/:id/attachments',
  authorize(PERMISSIONS.CASE_CREATE),
  raw({ type: () => true, limit: '25mb' }),
  c.uploadAttachment,
);
caseRoutes.get('/:id/attachments/:attachmentId/url', authorize(PERMISSIONS.CASE_VIEW), c.attachmentUrl);
caseRoutes.delete('/:id/attachments/:attachmentId', authorize(PERMISSIONS.CASE_CREATE), c.deleteAttachment);
caseRoutes.get('/', authorize(PERMISSIONS.CASE_VIEW), c.list);
caseRoutes.get('/:id', authorize(PERMISSIONS.CASE_VIEW), c.get);
