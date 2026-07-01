import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { authController as c } from './controller.js';
import { versionController } from './version.controller.js';
import { notificationController } from '../notifications/controller.js';
import { loginLimiter, refreshLimiter, sensitiveActionLimiter } from '../../http/rateLimit.js';
import { verifySameOrigin } from '../../http/sameOrigin.js';

/**
 * /api/v2/auth — login / refresh are unauthenticated; logout / me require a valid
 * access token (enforced in the controller via req.auth, populated by the
 * authenticate middleware). See ADR-0014.
 */
export const authRoutes: Router = Router();

// Brute-force / amplification guards (ADR-0076): per-IP flood caps on the unauthenticated surface.
authRoutes.post('/login', loginLimiter(), c.login);
authRoutes.post('/refresh', refreshLimiter(), verifySameOrigin(), c.refresh);
// Mobile force-update gate (mobile parity) — PUBLIC: a too-old app must learn it before it can auth.
authRoutes.post('/version-check', versionController.check);
authRoutes.post('/logout', c.logout);
authRoutes.get('/me', c.me);
// Self-service change-password — authenticated (req.auth); prove current password, set a strong new one.
// API_SECURITY-02: rate-limited per IP, same as login/refresh (previously relied only on the edge floor).
authRoutes.post('/change-password', sensitiveActionLimiter(), c.changePassword);

// FCM device-token registration (ADR-0027) — the device registers its push token (own user, no perm).
authRoutes.post('/notifications/register', notificationController.registerToken);

// MFA (slice 5) — enrol/status/disable are self-service (authenticated via req.auth). The admin-disable
// removes another user's enrolment and is gated by user.manage.
// API_SECURITY-02: enroll/verify/disable are account-security-sensitive — same per-IP cap as change-password.
authRoutes.get('/mfa/status', c.mfaStatus);
authRoutes.post('/mfa/enroll/start', sensitiveActionLimiter(), c.mfaEnrollStart);
authRoutes.post('/mfa/enroll/verify', sensitiveActionLimiter(), c.mfaEnrollVerify);
authRoutes.post('/mfa/disable', sensitiveActionLimiter(), c.mfaDisable);
authRoutes.post('/mfa/admin/:userId/disable', authorize(PERMISSIONS.USER_MANAGE), c.mfaAdminDisable);

// Sessions (slice 6) — self-service: list my active sessions + revoke one (revoke-one, not logout-all).
// Revoke is owner-scoped in the service (404 on someone else's jti). Admin equivalents are under /users.
authRoutes.get('/sessions', c.listSessions);
authRoutes.post('/sessions/:jti/revoke', c.revokeSession);

// Policy acceptances (ADR-0043) — self-service: this user's own acceptance log. Authenticated, no
// permission gate (same pattern as /me and /sessions). The admin per-user view lives under /policies.
authRoutes.get('/my-consents', c.myConsents);
