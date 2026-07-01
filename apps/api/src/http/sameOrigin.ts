import type { RequestHandler } from 'express';
import { HTTP_STATUS } from '../platform/http.js';

/**
 * CSRF defense for the one endpoint authenticated solely by an ambient cookie (the httpOnly refresh
 * cookie, ADR-0076 SEC-10) — CSRF-01, docs/audit/06-csrf.md. `SameSite=Lax` already blocks the classic
 * cross-site form-POST/fetch attack in modern browsers; this is a second, independent factor that
 * doesn't depend on cookie-attribute support: reject a request whose Origin/Referer declares a
 * DIFFERENT host than the one it was sent to. A request with NEITHER header (very old browsers, or a
 * non-browser client like the mobile app — which sends the refresh token in the body, not this cookie,
 * so it isn't even affected) is let through: this only blocks a request that actively contradicts its
 * own origin, not one that's silent about it.
 */
export function verifySameOrigin(): RequestHandler {
  return (req, res, next) => {
    const declared = req.headers.origin ?? req.headers.referer;
    if (!declared) return next();
    let declaredHost: string;
    try {
      declaredHost = new URL(declared).host;
    } catch {
      return next(); // unparseable header — don't block on it, the SameSite cookie still applies
    }
    if (declaredHost === req.headers.host) return next();
    res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'CROSS_ORIGIN_REQUEST' });
  };
}
