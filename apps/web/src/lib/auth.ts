/**
 * Browser token storage for the JWT-pair (ADR-0014). localStorage is acceptable for this
 * internal admin app; a future hardening pass can move to httpOnly cookies.
 */
const ACCESS_KEY = 'acs.accessToken';
const REFRESH_KEY = 'acs.refreshToken';

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
