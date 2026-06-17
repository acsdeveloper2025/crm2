import { Router } from 'express';
import { notificationController as c } from './controller.js';

/**
 * /api/v2/notifications — the in-app feed (ADR-0027). No permission gate: every authenticated user
 * reads their OWN feed (scope is identity, like /auth/me). The controller 401s when unauthenticated.
 * Static paths are declared before the `/:id` pattern (Express matches in order).
 */
export const notificationRoutes: Router = Router();

notificationRoutes.get('/', c.list);
notificationRoutes.get('/unread-count', c.unreadCount);
notificationRoutes.post('/mark-all-read', c.markAllRead);
notificationRoutes.post('/:id/read', c.read);
