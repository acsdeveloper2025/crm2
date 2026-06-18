import { Router } from 'express';
import { formsController as c } from './controller.js';

/**
 * /api/v2/forms — field form templates (mobile parity). Authenticated; returns `data: null` so the
 * device uses its bundled template (v2 has no server-side field-form template engine).
 */
export const formsRoutes: Router = Router();

formsRoutes.get('/:formType/template', c.template);
