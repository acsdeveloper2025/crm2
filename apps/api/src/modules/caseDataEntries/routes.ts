import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { caseDataEntryController as c } from './controller.js';

/**
 * /api/v2/data-entry (ADR-0037, MIS engine slice 3) — office data-entry: key a CASE's MIS fields
 * against its (client,product) active DATA_ENTRY layout (Zion `NewDataQC` keys these per case). Gated
 * `data_entry.manage` (office: MANAGER/BACKEND_USER + SA); the service scope-guards the case
 * (out-of-scope → 404). `:caseId` = the case UUID.
 */
export const caseDataEntryRoutes: Router = Router();

caseDataEntryRoutes.get('/cases/:caseId', authorize(PERMISSIONS.DATA_ENTRY_MANAGE), c.get);
caseDataEntryRoutes.put('/cases/:caseId', authorize(PERMISSIONS.DATA_ENTRY_MANAGE), c.save);
// Pickup Information — the fixed per-case office box (Zion NewDataQC), same perm + case scope.
caseDataEntryRoutes.get('/cases/:caseId/pickup', authorize(PERMISSIONS.DATA_ENTRY_MANAGE), c.getPickup);
caseDataEntryRoutes.put('/cases/:caseId/pickup', authorize(PERMISSIONS.DATA_ENTRY_MANAGE), c.savePickup);
