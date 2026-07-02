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
