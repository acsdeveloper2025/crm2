import type { Request, Response, NextFunction } from 'express';
import { fieldReportService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import type { Actor } from '../../platform/scope/index.js';

const actor = (req: Request): Actor => {
  if (!req.auth) throw AppError.unauthenticated();
  return { role: req.auth.role, userId: req.auth.userId };
};

export const fieldReportController = {
  /** GET /api/v2/cases/:id/tasks/:taskId/field-report — render the task's FIELD_REPORT narrative. */
  async getFieldReport(req: Request, res: Response, next: NextFunction) {
    try {
      const caseId = req.params['id'] ?? '';
      const taskId = req.params['taskId'] ?? '';
      res.json(await svc.render(caseId, taskId, actor(req)));
    } catch (e) {
      next(e);
    }
  },
};
