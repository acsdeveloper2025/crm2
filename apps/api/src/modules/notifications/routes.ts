import { Router } from 'express';
import { notificationController as c } from './controller.js';

/**
 * /api/v2/notifications — the in-app feed (ADR-0027). No permission gate: every authenticated user
 * reads their OWN feed (scope is identity, like /auth/me). The controller 401s when unauthenticated.
 * Static paths are declared before the `/:id` pattern (Express matches in order).
 *
 * Mobile parity (compat): the device manages its feed — trash/restore, per-task mute, preferences —
 * and uses PUT for read/mark-all-read (v2's canonical verb is POST). Both verbs are accepted.
 */
export const notificationRoutes: Router = Router();

notificationRoutes.get('/', c.list);
notificationRoutes.delete('/', c.clearAll); // clear-all (soft-delete every visible row)
notificationRoutes.get('/unread-count', c.unreadCount);
notificationRoutes.get('/trash', c.listTrash);
notificationRoutes.post('/restore', c.restoreAll); // bulk restore (static — before /:id)
notificationRoutes.put('/restore', c.restoreAll); // device verb (compat)
notificationRoutes.get('/mutes', c.listMutes);
notificationRoutes.post('/mute', c.mute);
notificationRoutes.delete('/mute/task/:taskId', c.unmuteTask);
notificationRoutes.get('/preferences', c.getPreferences);
notificationRoutes.put('/preferences', c.setPreferences);
notificationRoutes.post('/mark-all-read', c.markAllRead);
notificationRoutes.put('/mark-all-read', c.markAllRead); // device verb (compat)
notificationRoutes.post('/:id/read', c.read);
notificationRoutes.put('/:id/read', c.read); // device verb (compat)
notificationRoutes.post('/:id/restore', c.restoreOne);
notificationRoutes.delete('/:id', c.deleteOne);
