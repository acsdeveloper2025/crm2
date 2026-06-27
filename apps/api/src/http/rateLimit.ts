import type { RequestHandler } from 'express';
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
    // `lazyLimiter` builds this ONCE on the first request (memoized) to avoid calling loadEnv() at
    // module import (which crashed the env-less OpenAPI CLI). That trips express-rate-limit's
    // creation-in-handler guard, which assumes per-request creation (a new store each time) — false
    // here since we cache the instance. Disable just that check; the limiter is stable. (The guard is
    // auto-off in production anyway — this keeps dev/test/e2e working too.)
    validate: { creationStack: false },
  });
}

/**
 * Wrap a limiter factory so it builds (and reads config) on the FIRST request, not at module load.
 * Mounting these on routes must not call loadEnv() eagerly — importing the app (e.g. the OpenAPI CLI,
 * which has no DATABASE_URL) would otherwise crash at import time. Built once, then cached.
 */
function lazyLimiter(build: () => RateLimitRequestHandler): RequestHandler {
  let limiter: RateLimitRequestHandler | null = null;
  return (req, res, next) => {
    limiter ??= build();
    return limiter(req, res, next);
  };
}

/** Per-IP cap on login attempts (flood cap; the DB per-account lockout is the brute-force control). */
export function loginLimiter(): RequestHandler {
  return lazyLimiter(() => {
    const env = loadEnv();
    return make(env.RATE_LIMIT_LOGIN_WINDOW_MS, env.RATE_LIMIT_LOGIN_MAX);
  });
}

/** Per-IP cap on token refresh (cheap-amplification guard). */
export function refreshLimiter(): RequestHandler {
  return lazyLimiter(() => {
    const env = loadEnv();
    return make(env.RATE_LIMIT_LOGIN_WINDOW_MS, env.RATE_LIMIT_REFRESH_MAX);
  });
}
