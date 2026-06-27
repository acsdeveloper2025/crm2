/**
 * Browser token storage (ADR-0014, hardened by ADR-0076 SEC-10). The refresh token is NO LONGER kept
 * in JS-readable storage — it lives in an httpOnly cookie the browser sends automatically on the auth
 * routes, so an XSS can't exfiltrate it. We keep only the short-lived access token (Bearer header) and
 * the refresh-token `jti` (a non-secret session handle the server returns at login/refresh), used for
 * the sessions list + idle-logout self-revoke.
 */
const ACCESS_KEY = 'acs.accessToken';
const JTI_KEY = 'acs.jti';
const DEVICE_KEY = 'acs.deviceId';
const SESSION_STARTED_KEY = 'acs.sessionStartedAt';

export const tokenStore = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  /** jti of the current session (returned by login/refresh; the refresh token itself is cookie-only). */
  jti: (): string | null => localStorage.getItem(JTI_KEY),
  set(accessToken: string, jti: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(JTI_KEY, jti);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(JTI_KEY);
  },
  /** Stable per-browser device id (ADR-0045) sent at login so the server's device-targeted
   *  `auth:session_revoked` realtime emit reaches this web session. Persists across logins. */
  deviceId(): string {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  },
  /** Wall-clock anchor for the absolute session cap (ADR-0045); stamped at login, read by the
   *  session manager, cleared on logout. */
  markSessionStart(): void {
    localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
  },
  clearSessionStart(): void {
    localStorage.removeItem(SESSION_STARTED_KEY);
  },
};
