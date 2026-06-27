import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { loadEnv } from '@crm2/config';
import { HTTP_STATUS } from '../platform/http.js';

/**
 * Rate-limiter factory (ADR-0076 — DoS hardening). Guards the unauthenticated auth surface against
 * per-IP flooding (password-spray, refresh amplification). Uses express-rate-limit's in-memory store
 * — correct for the single-instance prod topology; the nginx `limit_req` floor covers blue-green
 * overlaps + restarts, and the existing DB per-account lockout is the credential-stuffing control.
 *
 * Keying is per `req.ip`, which is the real client only because app.ts sets `trust proxy` (the edge
 * is the one hop). A 429 returns the canonical `{ error: 'TOO_MANY_REQUESTS' }` shape.
 *
 * (When prod moves multi-instance + Valkey, swap the store for rate-limit-redis — that is the only
 * change; thresholds already live in @crm2/config.)
 */
const TOO_MANY = { error: 'TOO_MANY_REQUESTS' as const };

function make(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
    message: TOO_MANY,
  });
}

/** Per-IP cap on login attempts (flood cap; the DB per-account lockout is the brute-force control). */
export function loginLimiter(): RateLimitRequestHandler {
  const env = loadEnv();
  return make(env.RATE_LIMIT_LOGIN_WINDOW_MS, env.RATE_LIMIT_LOGIN_MAX);
}

/** Per-IP cap on token refresh (cheap-amplification guard). */
export function refreshLimiter(): RateLimitRequestHandler {
  const env = loadEnv();
  return make(env.RATE_LIMIT_LOGIN_WINDOW_MS, env.RATE_LIMIT_REFRESH_MAX);
}
