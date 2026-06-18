/**
 * Browser token storage for the JWT-pair (ADR-0014). localStorage is acceptable for this
 * internal admin app; a future hardening pass can move to httpOnly cookies.
 */
const ACCESS_KEY = 'acs.accessToken';
const REFRESH_KEY = 'acs.refreshToken';
const DEVICE_KEY = 'acs.deviceId';
const SESSION_STARTED_KEY = 'acs.sessionStartedAt';

export const tokenStore = {
  access: (): string | null => localStorage.getItem(ACCESS_KEY),
  refresh: (): string | null => localStorage.getItem(REFRESH_KEY),
  set(accessToken: string, refreshToken: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
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
  /** jti of the current session, decoded from the stored refresh token (slice 6). Unverified — the
   *  jti is a non-secret session handle, used only to flag the caller's own "this device" row. */
  jti(): string | null {
    const token = localStorage.getItem(REFRESH_KEY);
    const segment = token?.split('.')[1];
    if (!segment) return null;
    try {
      const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as {
        jti?: unknown;
      };
      return typeof payload.jti === 'string' ? payload.jti : null;
    } catch {
      return null;
    }
  },
};
