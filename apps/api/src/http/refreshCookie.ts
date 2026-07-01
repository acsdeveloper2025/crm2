import type { Request, Response } from 'express';
import { loadEnv } from '@crm2/config';
import { safeDecodeURIComponent } from '../platform/http.js';

/**
 * Refresh-token httpOnly cookie (ADR-0076 SEC-10). The web stores the refresh token here instead of
 * localStorage so an XSS can't exfiltrate it (it stays out of JS reach). The MOBILE app is unaffected:
 * it keeps sending/receiving the refresh token in the request/response body (no cookie), and the
 * refresh endpoint accepts either. Secure is on only in production (dev is http, where a Secure cookie
 * would not be stored); SameSite=Lax + a path scoped to the auth routes keeps the cookie tightly bound.
 */
const NAME = 'crm2_rt';
const COOKIE_PATH = '/api/v2/auth';
const MS_PER_S = 1000;

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: loadEnv().NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: loadEnv().AUTH_REFRESH_TTL_S * MS_PER_S,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(NAME, { path: COOKIE_PATH });
}

/** Read the refresh cookie from the raw Cookie header (no cookie-parser dependency). */
export function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === NAME) return safeDecodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
